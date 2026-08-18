import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { fetchFixtureById, fetchFixtureStatistics } from '@/lib/apiFootball';

export const maxDuration = 300;

const TIME_BUDGET_MS = Number(process.env.BACKTEST_TIME_BUDGET_MS || '260000');

function extractCorners(statsResponse: any[], teamId: number): number | null {
  const teamBlock = statsResponse.find((b: any) => b?.team?.id === teamId);
  if (!teamBlock) return null;
  const stat = (teamBlock.statistics || []).find((s: any) => s.type === 'Corner Kicks');
  if (!stat || stat.value === null || stat.value === undefined) return null;
  return Number(stat.value);
}

function extractCards(statsResponse: any[], teamId: number): number | null {
  const teamBlock = statsResponse.find((b: any) => b?.team?.id === teamId);
  if (!teamBlock) return null;
  const yellowStat = (teamBlock.statistics || []).find((s: any) => s.type === 'Yellow Cards');
  const redStat = (teamBlock.statistics || []).find((s: any) => s.type === 'Red Cards');
  const yellow = yellowStat && yellowStat.value !== null && yellowStat.value !== undefined ? Number(yellowStat.value) : 0;
  const red = redStat && redStat.value !== null && redStat.value !== undefined ? Number(redStat.value) : 0;
  if (!yellowStat && !redStat) return null;
  return yellow + red;
}

function extractShots(statsResponse: any[], teamId: number): number | null {
  const teamBlock = statsResponse.find((b: any) => b?.team?.id === teamId);
  if (!teamBlock) return null;
  const stat = (teamBlock.statistics || []).find((s: any) => s.type === 'Total Shots');
  if (!stat || stat.value === null || stat.value === undefined) return null;
  return Number(stat.value);
}

// Verifica daca o predictie a fost corecta, pe baza rezultatului real.
// Returneaza null daca nu putem verifica (ex. lipsesc statisticile).
function checkPrediction(
  market: string,
  selection: string,
  homeGoals: number,
  awayGoals: number,
  homeCorners: number | null,
  awayCorners: number | null,
  homeCards: number | null,
  awayCards: number | null,
  homeShots: number | null,
  awayShots: number | null
): boolean | null {
  const totalGoals = homeGoals + awayGoals;
  const btts = homeGoals >= 1 && awayGoals >= 1;
  const over25 = totalGoals > 2.5;

  if (market === '1X2') {
    if (selection === '1') return homeGoals > awayGoals;
    if (selection === 'X') return homeGoals === awayGoals;
    if (selection === '2') return awayGoals > homeGoals;
  }
  if (market === 'BTTS') {
    if (selection === 'YES') return btts;
    if (selection === 'NO') return !btts;
  }
  if (market === 'OU25') {
    if (selection === 'OVER') return over25;
    if (selection === 'UNDER') return !over25;
  }
  if (market === 'DC' && selection === '12') return homeGoals !== awayGoals;
  if (market === 'COMBO') {
    if (selection === 'GG_PESTE25') return btts && over25;
    if (selection === 'GG_SUB25') return btts && !over25;
    if (selection === 'NG_PESTE25') return !btts && over25;
    if (selection === 'NG_SUB25') return !btts && !over25;
  }
  if (market === 'CORNERS' || market === 'CARDS' || market === 'SHOTS') {
    const home = market === 'CORNERS' ? homeCorners : market === 'CARDS' ? homeCards : homeShots;
    const away = market === 'CORNERS' ? awayCorners : market === 'CARDS' ? awayCards : awayShots;
    if (home === null || away === null) return null;

    const parts = selection.split('_');
    const scope = parts[0];
    const direction = parts[1];
    const threshold = parseFloat(parts[2]);

    if (scope === 'BOTH') {
      return home > threshold && away > threshold;
    }

    let actualValue: number;
    if (scope === 'TOTAL') actualValue = home + away;
    else if (scope === '1') actualValue = home;
    else if (scope === '2') actualValue = away;
    else return null;

    if (direction === 'OVER') return actualValue > threshold;
    if (direction === 'UNDER') return actualValue < threshold;
  }
  return null;
}

// Grupeaza predictiile complementare (DA/NU, Peste/Sub la acelasi
// prag) sub aceeasi cheie, ca sa pastram doar recomandarea reala -
// varianta cu probabilitatea mai mare - nu ambele parti.
function getGroupKey(market: string, selection: string): string {
  if (market === '1X2' || market === 'BTTS' || market === 'OU25' || market === 'COMBO') {
    return market;
  }
  if (market === 'CORNERS' || market === 'CARDS' || market === 'SHOTS') {
    if (selection.indexOf('BOTH_') === 0) {
      return market + '_' + selection;
    }
    const withoutDirection = selection.replace('_OVER_', '_').replace('_UNDER_', '_');
    return market + '_' + withoutDirection;
  }
  return market + '_' + selection;
}

function bucketKeyFor(probability: number): string {
  if (probability >= 0.9) return '90-100';
  if (probability >= 0.8) return '80-90';
  if (probability >= 0.7) return '70-80';
  if (probability >= 0.6) return '60-70';
  if (probability >= 0.5) return '50-60';
  return 'sub-50';
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== 'Bearer ' + process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Neautorizat' }, { status: 401 });
  }

  const startTime = Date.now();
  const requestUrl = new URL(request.url);
  const days = parseInt(requestUrl.searchParams.get('days') || '10', 10);

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const cutoffStr = cutoff.toISOString();
  const nowStr = new Date().toISOString();

  const { data: matches } = await supabaseAdmin
    .from('matches')
    .select('id, api_football_id, home_team_name, away_team_name, kickoff_utc')
    .gte('kickoff_utc', cutoffStr)
    .lt('kickoff_utc', nowStr);

  if (!matches || matches.length === 0) {
    return NextResponse.json({ success: true, message: 'Niciun meci in trecut de verificat in acest interval.', buckets: [] });
  }

  const buckets: Record<string, { total: number; correct: number }> = {
    '90-100': { total: 0, correct: 0 },
    '80-90': { total: 0, correct: 0 },
    '70-80': { total: 0, correct: 0 },
    '60-70': { total: 0, correct: 0 },
    '50-60': { total: 0, correct: 0 },
    'sub-50': { total: 0, correct: 0 },
  };

  const perMarketBuckets: Record<string, { total: number; correct: number }> = {};

  let matchesVerificate = 0;
  let matchesNeterminate = 0;
  let matchesFaraPredictii = 0;
  const apiErrors: any[] = [];
  const sampleDetails: any[] = [];
  const SAMPLE_SIZE = 20;

  for (const match of matches) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      apiErrors.push({ context: 'backtest', message: 'Oprit din verificare din lipsa de timp - au ramas meciuri neverificate in aceasta rulare.' });
      break;
    }

    const fixture = await fetchFixtureById(match.api_football_id);
    if (!fixture || fixture.fixture.status.short !== 'FT') {
      matchesNeterminate++;
      continue;
    }

    const homeGoals = fixture.goals.home;
    const awayGoals = fixture.goals.away;

    const { data: predictions } = await supabaseAdmin
      .from('predictions')
      .select('market, selection, label, probability')
      .eq('match_id', match.id);

    if (!predictions || predictions.length === 0) {
      matchesFaraPredictii++;
      continue;
    }

    const needsStats = predictions.some((p: any) => p.market === 'CORNERS' || p.market === 'CARDS' || p.market === 'SHOTS');
    let homeCorners: number | null = null;
    let awayCorners: number | null = null;
    let homeCards: number | null = null;
    let awayCards: number | null = null;
    let homeShots: number | null = null;
    let awayShots: number | null = null;

    if (needsStats) {
      const stats = await fetchFixtureStatistics(match.api_football_id);
      homeCorners = extractCorners(stats, fixture.teams.home.id);
      awayCorners = extractCorners(stats, fixture.teams.away.id);
      homeCards = extractCards(stats, fixture.teams.home.id);
      awayCards = extractCards(stats, fixture.teams.away.id);
      homeShots = extractShots(stats, fixture.teams.home.id);
      awayShots = extractShots(stats, fixture.teams.away.id);
    }

    // Pastram DOAR recomandarea reala (probabilitatea mai mare) per
    // grup (piata + prag), nu toate variantele stocate.
    const topPerGroup = new Map<string, any>();
    for (const p of predictions) {
      const groupKey = getGroupKey(p.market, p.selection);
      const existing = topPerGroup.get(groupKey);
      if (!existing || p.probability > existing.probability) {
        topPerGroup.set(groupKey, p);
      }
    }

    for (const p of topPerGroup.values()) {
      const correct = checkPrediction(
        p.market, p.selection, homeGoals, awayGoals,
        homeCorners, awayCorners, homeCards, awayCards, homeShots, awayShots
      );
      if (correct === null) continue;

      const key = bucketKeyFor(p.probability);
      buckets[key].total++;
      if (correct) buckets[key].correct++;

      if (!perMarketBuckets[p.market]) perMarketBuckets[p.market] = { total: 0, correct: 0 };
      perMarketBuckets[p.market].total++;
      if (correct) perMarketBuckets[p.market].correct++;

      if (sampleDetails.length < SAMPLE_SIZE && p.market !== '1X2') {
        sampleDetails.push({
          meci: match.home_team_name + ' - ' + match.away_team_name,
          scorReal: homeGoals + '-' + awayGoals,
          piata: p.market,
          selectiaNoastra: p.selection,
          etichetaNoastra: p.label,
          probabilitateaNoastra: Math.round(p.probability * 100) + '%',
          corect: correct,
        });
      }
    }

    matchesVerificate++;
  }

  const bucketSummary = Object.entries(buckets).map(([range, data]) => ({
    interval: range + '%',
    predictiiVerificate: data.total,
    predictiiCorecte: data.correct,
    acurateteReala: data.total > 0 ? Math.round((data.correct / data.total) * 100) + '%' : 'N/A',
  }));

  const marketSummary = Object.entries(perMarketBuckets).map(([market, data]) => ({
    piata: market,
    predictiiVerificate: data.total,
    predictiiCorecte: data.correct,
    acurateteReala: data.total > 0 ? Math.round((data.correct / data.total) * 100) + '%' : 'N/A',
  }));

  return NextResponse.json({
    success: true,
    intervalZile: days,
    elapsedMs: Date.now() - startTime,
    matchesVerificate: matchesVerificate,
    matchesNeterminate: matchesNeterminate,
    matchesFaraPredictii: matchesFaraPredictii,
    acurateteReala_pePraguriDeIncredere: bucketSummary,
    acurateteReala_pePiata: marketSummary,
    esantionDetaliat: sampleDetails,
    apiErrors: apiErrors,
  });
}
