import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  fetchSeasonFixtures,
  fetchTeamStatistics,
  fetchOddsByFixture,
  fetchHeadToHead,
  fetchTeamSeasonFixtures,
  fetchFixtureStatistics,
  fetchInjuries,
  inferSeason,
} from '@/lib/apiFootball';
import { calculateAllMarkets, calculateCornerMarkets, calculateCardMarkets, TeamForm, HeadToHeadStats, LeagueAverages } from '@/lib/poisson';
import { generateAIAnalysis } from '@/lib/aiAnalysis';

export const maxDuration = 60;

// Liga 1 Romania, top 5 european, cupe europene, plus ligi
// suplimentare - posibil acum datorita planului platit.
// 283 Liga 1 Romania, 39 Premier League, 140 La Liga, 135 Serie A,
// 78 Bundesliga, 61 Ligue 1, 2 Champions League, 3 Europa League,
// 848 Conference League, 88 Eredivisie, 94 Primeira Liga (Portugalia),
// 144 Jupiler Pro League (Belgia), 203 Super Lig (Turcia),
// 71 Brasileirao (Brazilia), 253 MLS (SUA), 262 Liga MX (Mexic),
// 40 Championship (Anglia, liga 2), 179 Scottish Premiership
const TRACKED_LEAGUES = [283, 39, 140, 135, 78, 61, 2, 3, 848, 88, 94, 144, 203, 71, 253, 262, 40, 179];
const DAYS_AHEAD = 7;
const DAYS_WITH_FULL_ANALYSIS = 3;

// Configurabil din Vercel (Settings -> Environment Variables), fara
// cod nou. Creste-l dupa ce treci pe plan platit la API-Football.
const MAX_FIXTURES_FULL_ANALYSIS = Number(process.env.MAX_FIXTURES_FULL_ANALYSIS || '4');

const RECENT_FORM_WEIGHT = 0.4;
const RECENCY_WEIGHTS = [0.35, 0.25, 0.18, 0.13, 0.09];
const INJURY_PENALTY_THRESHOLD = 3;
const INJURY_PENALTY_FACTOR = 0.95;

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

function filterBeforeDateAndTakeLast(fixtures: any[], beforeDateStr: string, n: number): any[] {
  const beforeTime = new Date(beforeDateStr).getTime();
  const finished = fixtures.filter((f: any) => {
    if (f?.fixture?.status?.short !== 'FT') return false;
    return new Date(f.fixture.date).getTime() < beforeTime;
  });
  finished.sort((a: any, b: any) => new Date(b.fixture.date).getTime() - new Date(a.fixture.date).getTime());
  return finished.slice(0, n);
}

function computeLeagueAverages(seasonFixtures: any[]): LeagueAverages {
  const finished = seasonFixtures.filter((f: any) => f?.fixture?.status?.short === 'FT');
  if (finished.length === 0) {
    return { avgHomeGoals: 1.45, avgAwayGoals: 1.15 };
  }
  let sumHome = 0;
  let sumAway = 0;
  for (const f of finished) {
    sumHome += f.goals?.home ?? 0;
    sumAway += f.goals?.away ?? 0;
  }
  return { avgHomeGoals: sumHome / finished.length, avgAwayGoals: sumAway / finished.length };
}

function computeRecencyWeightedForm(recentFixtures: any[], teamId: number): { avgScored: number; avgConceded: number } | null {
  if (recentFixtures.length === 0) return null;

  let scored = 0;
  let conceded = 0;
  let weightSum = 0;

  recentFixtures.forEach((f: any, idx: number) => {
    const w = RECENCY_WEIGHTS[idx] ?? 0.05;
    const isHome = f.teams.home.id === teamId;
    const goalsFor = isHome ? f.goals.home : f.goals.away;
    const goalsAgainst = isHome ? f.goals.away : f.goals.home;
    scored += goalsFor * w;
    conceded += goalsAgainst * w;
    weightSum += w;
  });

  return { avgScored: scored / weightSum, avgConceded: conceded / weightSum };
}

function blendWithRecentForm(seasonForm: TeamForm, recentForm: { avgScored: number; avgConceded: number } | null): TeamForm {
  if (!recentForm) return seasonForm;
  return {
    avgGoalsScored: seasonForm.avgGoalsScored * (1 - RECENT_FORM_WEIGHT) + recentForm.avgScored * RECENT_FORM_WEIGHT,
    avgGoalsConceded: seasonForm.avgGoalsConceded * (1 - RECENT_FORM_WEIGHT) + recentForm.avgConceded * RECENT_FORM_WEIGHT,
  };
}

function applyInjuryPenalty(form: TeamForm, injuryCount: number): TeamForm {
  if (injuryCount < INJURY_PENALTY_THRESHOLD) return form;
  return { avgGoalsScored: form.avgGoalsScored * INJURY_PENALTY_FACTOR, avgGoalsConceded: form.avgGoalsConceded };
}

function computeH2HStats(h2hFixturesFiltered: any[]): HeadToHeadStats | undefined {
  if (h2hFixturesFiltered.length === 0) return undefined;

  let bttsCount = 0;
  let over25Count = 0;
  for (const f of h2hFixturesFiltered) {
    const homeGoals = f?.goals?.home ?? 0;
    const awayGoals = f?.goals?.away ?? 0;
    if (homeGoals >= 1 && awayGoals >= 1) bttsCount++;
    if (homeGoals + awayGoals > 2.5) over25Count++;
  }

  return {
    matchesCount: h2hFixturesFiltered.length,
    bttsRate: bttsCount / h2hFixturesFiltered.length,
    over25Rate: over25Count / h2hFixturesFiltered.length,
  };
}

function extractRecentForm(fixtures: any[], teamId: number): any[] {
  return fixtures.map((f: any) => {
    const isHome = f.teams.home.id === teamId;
    const goalsFor = isHome ? f.goals.home : f.goals.away;
    const goalsAgainst = isHome ? f.goals.away : f.goals.home;
    const opponent = isHome ? f.teams.away.name : f.teams.home.name;
    let result = 'D';
    if (goalsFor > goalsAgainst) result = 'W';
    else if (goalsFor < goalsAgainst) result = 'L';
    return {
      date: f.fixture.date,
      opponent: opponent,
      venue: isHome ? 'acasa' : 'deplasare',
      scoreFor: goalsFor,
      scoreAgainst: goalsAgainst,
      result: result,
    };
  });
}

function extractH2HList(fixtures: any[]): any[] {
  return fixtures.map((f: any) => ({
    date: f.fixture.date,
    homeTeam: f.teams.home.name,
    awayTeam: f.teams.away.name,
    homeGoals: f.goals.home,
    awayGoals: f.goals.away,
  }));
}

function extractCorners(statsResponse: any[], teamId: number): number | null {
  const teamBlock = statsResponse.find((b: any) => b?.team?.id === teamId);
  if (!teamBlock) return null;
  const cornerStat = (teamBlock.statistics || []).find((s: any) => s.type === 'Corner Kicks');
  if (!cornerStat || cornerStat.value === null || cornerStat.value === undefined) return null;
  return Number(cornerStat.value);
}

// Refolosim ACELASI raspuns de statistici (nicio cerere API in plus).
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

function computeAverage(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v !== null && !isNaN(v));
  if (valid.length === 0) return null;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}

function extractInjuries(injuriesResponse: any[]): any[] {
  return injuriesResponse.slice(0, 10).map((item: any) => ({
    playerName: item?.player?.name || 'Necunoscut',
    reason: item?.player?.reason || item?.player?.type || 'Nespecificat',
  }));
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

    const leagueAvg = computeLeagueAverages(result.fixtures);

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

        const homeSeasonBlendForm = extractTeamForm(homeStats, 'home');
        const awaySeasonBlendForm = extractTeamForm(awayStats, 'away');

        const h2hResult = await fetchHeadToHead(homeTeam.id, awayTeam.id, fixtureSeason);
        if (h2hResult.errors.length > 0) allApiErrors.push(...h2hResult.errors);
        const h2hFiltered = filterBeforeDateAndTakeLast(h2hResult.fixtures, fixtureDateStr, 5);
        const h2hStats = computeH2HStats(h2hFiltered);
        const h2hList = extractH2HList(h2hFiltered);

        const homeSeasonResult = await fetchTeamSeasonFixtures(homeTeam.id, fixtureSeason);
        if (homeSeasonResult.errors.length > 0) allApiErrors.push(...homeSeasonResult.errors);
        const awaySeasonResult = await fetchTeamSeasonFixtures(awayTeam.id, fixtureSeason);
        if (awaySeasonResult.errors.length > 0) allApiErrors.push(...awaySeasonResult.errors);

        const homeRecentFixtures = filterBeforeDateAndTakeLast(homeSeasonResult.fixtures, fixtureDateStr, 5);
        const awayRecentFixtures = filterBeforeDateAndTakeLast(awaySeasonResult.fixtures, fixtureDateStr, 5);

        const homeRecentForm = extractRecentForm(homeRecentFixtures, homeTeam.id);
        const awayRecentForm = extractRecentForm(awayRecentFixtures, awayTeam.id);

        const homeRecencyGoals = computeRecencyWeightedForm(homeRecentFixtures, homeTeam.id);
        const awayRecencyGoals = computeRecencyWeightedForm(awayRecentFixtures, awayTeam.id);

        let homeForm = blendWithRecentForm(homeSeasonBlendForm, homeRecencyGoals);
        let awayForm = blendWithRecentForm(awaySeasonBlendForm, awayRecencyGoals);

        const homeCornersValues: (number | null)[] = [];
        const homeCardsValues: (number | null)[] = [];
        for (const f of homeRecentFixtures) {
          const stats = await fetchFixtureStatistics(f.fixture.id);
          homeCornersValues.push(extractCorners(stats, homeTeam.id));
          homeCardsValues.push(extractCards(stats, homeTeam.id));
        }
        const awayCornersValues: (number | null)[] = [];
        const awayCardsValues: (number | null)[] = [];
        for (const f of awayRecentFixtures) {
          const stats = await fetchFixtureStatistics(f.fixture.id);
          awayCornersValues.push(extractCorners(stats, awayTeam.id));
          awayCardsValues.push(extractCards(stats, awayTeam.id));
        }
        const homeAvgCorners = computeAverage(homeCornersValues);
        const awayAvgCorners = computeAverage(awayCornersValues);
        const homeAvgCards = computeAverage(homeCardsValues);
        const awayAvgCards = computeAverage(awayCardsValues);

        const homeInjuriesResult = await fetchInjuries(homeTeam.id, fixtureSeason);
        if (homeInjuriesResult.errors.length > 0) allApiErrors.push(...homeInjuriesResult.errors);
        const awayInjuriesResult = await fetchInjuries(awayTeam.id, fixtureSeason);
        if (awayInjuriesResult.errors.length > 0) allApiErrors.push(...awayInjuriesResult.errors);

        const homeInjuries = extractInjuries(homeInjuriesResult.injuries);
        const awayInjuries = extractInjuries(awayInjuriesResult.injuries);

        homeForm = applyInjuryPenalty(homeForm, homeInjuries.length);
        awayForm = applyInjuryPenalty(awayForm, awayInjuries.length);

        const goalMarkets = calculateAllMarkets(homeForm, awayForm, h2hStats, leagueAvg);
        const cornerMarkets = calculateCornerMarkets(homeAvgCorners, awayAvgCorners);
        const cardMarkets = calculateCardMarkets(homeAvgCards, awayAvgCards);
        const allMarkets = goalMarkets.concat(cornerMarkets, cardMarkets).sort((a, b) => b.probability - a.probability);

        await supabaseAdmin.from('predictions').delete().eq('match_id', matchRow.id);
        const predictionRows = allMarkets.map((m) => ({
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

        const aiResult = await generateAIAnalysis({
          homeTeam: homeTeam.name,
          awayTeam: awayTeam.name,
          topMarkets: allMarkets.slice(0, 3).map((m) => ({ label: m.label, probability: m.probability })),
          homeForm: homeRecentForm,
          awayForm: awayRecentForm,
          h2hMatches: h2hList,
          homeAvgCorners: homeAvgCorners,
          awayAvgCorners: awayAvgCorners,
          homeAvgCards: homeAvgCards,
          awayAvgCards: awayAvgCards,
          homeInjuriesCount: homeInjuries.length,
          awayInjuriesCount: awayInjuries.length,
        });
        const aiAnalysisText = aiResult.text;
        if (aiResult.error) {
          allApiErrors.push({ context: 'analiza AI (Gemini)', match: homeTeam.name + ' - ' + awayTeam.name, message: aiResult.error });
        }

        await supabaseAdmin.from('match_analysis').upsert(
          {
            match_id: matchRow.id,
            home_recent_form: homeRecentForm,
            away_recent_form: awayRecentForm,
            h2h_matches: h2hList,
            home_avg_corners: homeAvgCorners,
            away_avg_corners: awayAvgCorners,
            home_avg_cards: homeAvgCards,
            away_avg_cards: awayAvgCards,
            home_injuries: homeInjuries,
            away_injuries: awayInjuries,
            ai_analysis: aiAnalysisText,
          },
          { onConflict: 'match_id' }
        );

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
    maxFixturesFullAnalysis: MAX_FIXTURES_FULL_ANALYSIS,
    processed: totalProcessed,
    withAnalysis: totalWithAnalysis,
    fullAnalysisBudgetUsed: fullAnalysisBudgetUsed,
    days: summary,
    apiErrors: allApiErrors.slice(0, 20),
  });
}
