#!/usr/bin/env node
// Repara eroarea 429 (too many requests per minute) adaugand o pauza
// intre cererile catre API-Football. Adauga si o limita de siguranta
// la numarul de meciuri analizate per sincronizare, ca sa nu depasim
// timpul maxim de executie permis de Vercel.

const fs = require('fs');
const path = require('path');

function writeFile(relativePath, content) {
  const fullPath = path.join(__dirname, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, { encoding: 'utf8' });
  console.log('Actualizat: ' + relativePath);
}

writeFile('lib/apiFootball.ts', `// Client minimal pentru API-Football (api-sports.io / api-football.com)
// Documentatie: https://www.api-football.com/documentation-v3

const API_BASE = 'https://v3.football.api-sports.io';

// Pauza intre cereri, ca sa nu depasim limita "per minut" a planului
// gratuit (eroare 429). Ajusteaza aici daca tot apar erori 429 -
// mareste valoarea; daca vrei sincronizare mai rapida pe plan platit
// (limite mai mari), poti scadea valoarea.
const REQUEST_DELAY_MS = 700;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getHeaders() {
  return {
    'x-apisports-key': process.env.API_FOOTBALL_KEY || '',
  };
}

async function apiCall(url: string): Promise<{ data: any; status: number }> {
  const res = await fetch(url, { headers: getHeaders() });
  const data = await res.json();
  await sleep(REQUEST_DELAY_MS);
  return { data: data, status: res.status };
}

export function inferSeason(dateStr: string): number {
  const d = new Date(dateStr);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  return month >= 7 ? year : year - 1;
}

export interface FixturesResult {
  fixtures: any[];
  errors: any[];
}

export async function fetchSeasonFixtures(leagueId: number, season: number): Promise<FixturesResult> {
  const url = API_BASE + '/fixtures?league=' + leagueId + '&season=' + season;
  const { data, status } = await apiCall(url);

  const fixtures = (data && data.response) ? data.response : [];
  const errors: any[] = [];
  const hasErrors = data && data.errors && (
    Array.isArray(data.errors) ? data.errors.length > 0 : Object.keys(data.errors).length > 0
  );
  if (hasErrors) {
    errors.push({ leagueId: leagueId, season: season, httpStatus: status, apiErrors: data.errors, results: data.results });
  }

  return { fixtures: fixtures, errors: errors };
}

export async function fetchTeamStatistics(teamId: number, leagueId: number, season: number) {
  const url = API_BASE + '/teams/statistics?team=' + teamId + '&league=' + leagueId + '&season=' + season;
  const { data } = await apiCall(url);
  return data.response;
}

export async function fetchOddsByFixture(fixtureId: number) {
  const url = API_BASE + '/odds?fixture=' + fixtureId;
  const { data } = await apiCall(url);
  return data.response;
}

export async function fetchHeadToHead(teamId1: number, teamId2: number) {
  const url = API_BASE + '/fixtures/headtohead?h2h=' + teamId1 + '-' + teamId2 + '&last=8';
  const { data } = await apiCall(url);
  return (data && data.response) ? data.response : [];
}
`);

writeFile('app/api/sync/route.ts', `import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  fetchSeasonFixtures,
  fetchTeamStatistics,
  fetchOddsByFixture,
  fetchHeadToHead,
  inferSeason,
} from '@/lib/apiFootball';
import { calculateAllMarkets, TeamForm, HeadToHeadStats } from '@/lib/poisson';

// Timp maxim de executie permis pentru acest endpoint (secunde).
// Vercel Hobby permite pana la 60s fara Fluid Compute.
export const maxDuration = 60;

const TRACKED_LEAGUES = [283, 39, 140, 135, 78, 61, 2, 3, 848];
const DAYS_AHEAD = 7;
const DAYS_WITH_FULL_ANALYSIS = 3;

// Limita de siguranta: maxim atatea meciuri primesc analiza completa
// (stats + H2H + cote) intr-o singura rulare, ca sa nu depasim timpul
// maxim de executie. Meciurile ramase primesc analiza la urmatoarea
// rulare (cron-ul zilnic reia procesul).
const MAX_FIXTURES_FULL_ANALYSIS = 15;

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function extractTeamForm(stats: any, venue: 'home' | 'away'): TeamForm {
  const overallPlayed = stats?.fixtures?.played?.total || 1;
  const overallScored = stats?.goals?.for?.total?.total || 0;
  const overallConceded = stats?.goals?.against?.total?.total || 0;
  const overallAvgScored = overallScored / overallPlayed;
  const overallAvgConceded = overallConceded / overallPlayed;

  const venuePlayed = stats?.fixtures?.played?.[venue] || 0;

  if (venuePlayed === 0) {
    return { avgGoalsScored: overallAvgScored, avgGoalsConceded: overallAvgConceded };
  }

  const venueScored = stats?.goals?.for?.total?.[venue] || 0;
  const venueConceded = stats?.goals?.against?.total?.[venue] || 0;
  const venueAvgScored = venueScored / venuePlayed;
  const venueAvgConceded = venueConceded / venuePlayed;

  return {
    avgGoalsScored: venueAvgScored * 0.6 + overallAvgScored * 0.4,
    avgGoalsConceded: venueAvgConceded * 0.6 + overallAvgConceded * 0.4,
  };
}

function computeH2HStats(h2hFixtures: any[]): HeadToHeadStats | undefined {
  const finished = h2hFixtures.filter((f: any) => f?.fixture?.status?.short === 'FT');
  if (finished.length === 0) return undefined;

  let bttsCount = 0;
  let over25Count = 0;
  for (const f of finished) {
    const homeGoals = f?.goals?.home ?? 0;
    const awayGoals = f?.goals?.away ?? 0;
    if (homeGoals >= 1 && awayGoals >= 1) bttsCount++;
    if (homeGoals + awayGoals > 2.5) over25Count++;
  }

  return {
    matchesCount: finished.length,
    bttsRate: bttsCount / finished.length,
    over25Rate: over25Count / finished.length,
  };
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== 'Bearer ' + process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Neautorizat' }, { status: 401 });
  }

  const requestUrl = new URL(request.url);
  const testDate = requestUrl.searchParams.get('date');

  const targetDates: string[] = [];
  let referenceDateForSeason: string;

  if (testDate) {
    targetDates.push(testDate);
    referenceDateForSeason = testDate;
  } else {
    const today = new Date();
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() + i);
      targetDates.push(formatDate(d));
    }
    referenceDateForSeason = formatDate(today);
  }

  const fullAnalysisDates = new Set(testDate ? targetDates : targetDates.slice(0, DAYS_WITH_FULL_ANALYSIS));
  const season = inferSeason(referenceDateForSeason);

  let totalProcessed = 0;
  let totalWithAnalysis = 0;
  let fullAnalysisBudgetUsed = 0;
  const allApiErrors: any[] = [];
  const matchesPerDate: Record<string, number> = {};
  targetDates.forEach((d) => { matchesPerDate[d] = 0; });

  for (const leagueId of TRACKED_LEAGUES) {
    const result = await fetchSeasonFixtures(leagueId, season);
    if (result.errors.length > 0) {
      allApiErrors.push(...result.errors);
    }

    for (const fixture of result.fixtures) {
      const fixtureDateStr = fixture.fixture.date.split('T')[0];
      if (!targetDates.includes(fixtureDateStr)) continue;

      const fixtureId = fixture.fixture.id;
      const fixtureLeagueId = fixture.league.id;
      const fixtureSeason = fixture.league.season;
      const homeTeam = fixture.teams.home;
      const awayTeam = fixture.teams.away;

      await supabaseAdmin.from('teams').upsert(
        [
          { api_football_id: homeTeam.id, name: homeTeam.name, league_id: fixtureLeagueId },
          { api_football_id: awayTeam.id, name: awayTeam.name, league_id: fixtureLeagueId },
        ],
        { onConflict: 'api_football_id' }
      );

      const { data: matchRow } = await supabaseAdmin
        .from('matches')
        .upsert(
          {
            api_football_id: fixtureId,
            league_id: fixtureLeagueId,
            home_team_name: homeTeam.name,
            away_team_name: awayTeam.name,
            kickoff_utc: fixture.fixture.date,
            status: fixture.fixture.status.short,
          },
          { onConflict: 'api_football_id' }
        )
        .select()
        .single();

      if (!matchRow) continue;

      matchesPerDate[fixtureDateStr] = (matchesPerDate[fixtureDateStr] || 0) + 1;
      totalProcessed++;

      if (!fullAnalysisDates.has(fixtureDateStr)) continue;
      if (fullAnalysisBudgetUsed >= MAX_FIXTURES_FULL_ANALYSIS) continue;

      fullAnalysisBudgetUsed++;

      try {
        const homeStats = await fetchTeamStatistics(homeTeam.id, fixtureLeagueId, fixtureSeason);
        const awayStats = await fetchTeamStatistics(awayTeam.id, fixtureLeagueId, fixtureSeason);

        const homeForm = extractTeamForm(homeStats, 'home');
        const awayForm = extractTeamForm(awayStats, 'away');

        const h2hFixtures = await fetchHeadToHead(homeTeam.id, awayTeam.id);
        const h2hStats = computeH2HStats(h2hFixtures);

        const markets = calculateAllMarkets(homeForm, awayForm, h2hStats);

        await supabaseAdmin.from('predictions').delete().eq('match_id', matchRow.id);
        const predictionRows = markets.map((m) => ({
          match_id: matchRow.id,
          market: m.market,
          selection: m.selection,
          label: m.label,
          probability: m.probability,
          fair_odds: m.fairOdds,
        }));
        await supabaseAdmin.from('predictions').insert(predictionRows);

        const odds = await fetchOddsByFixture(fixtureId);
        if (odds && odds.length > 0) {
          const oddsRows: any[] = [];
          for (const bookmakerEntry of odds[0]?.bookmakers || []) {
            for (const bet of bookmakerEntry.bets || []) {
              for (const value of bet.values || []) {
                oddsRows.push({
                  match_id: matchRow.id,
                  bookmaker: bookmakerEntry.name,
                  market: bet.name,
                  selection: value.value,
                  odd_value: parseFloat(value.odd),
                });
              }
            }
          }
          if (oddsRows.length > 0) {
            await supabaseAdmin.from('odds').delete().eq('match_id', matchRow.id);
            await supabaseAdmin.from('odds').insert(oddsRows);
          }
        }

        totalWithAnalysis++;
      } catch (err: any) {
        allApiErrors.push({
          fixtureId: fixtureId,
          context: 'analiza meci',
          match: homeTeam.name + ' - ' + awayTeam.name,
          message: err && err.message ? err.message : String(err),
        });
      }
    }
  }

  const summary = targetDates.map((d) => ({
    date: d,
    matches: matchesPerDate[d] || 0,
    fullAnalysis: fullAnalysisDates.has(d),
  }));

  return NextResponse.json({
    success: true,
    season: season,
    processed: totalProcessed,
    withAnalysis: totalWithAnalysis,
    fullAnalysisBudgetUsed: fullAnalysisBudgetUsed,
    days: summary,
    apiErrors: allApiErrors.slice(0, 15),
  });
}
`);

console.log('\\nGata! Acum ruleaza:');
console.log('  git add .');
console.log('  git commit -m "Repara eroarea 429: adauga pauza intre cereri si limita de siguranta"');
console.log('  git push');
