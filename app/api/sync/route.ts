import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  fetchSeasonFixtures,
  fetchTeamStatistics,
  fetchOddsByFixture,
  fetchHeadToHead,
  fetchTeamFixturesBefore,
  fetchFixtureStatistics,
  fetchInjuries,
  inferSeason,
  subtractOneDay,
} from '@/lib/apiFootball';
import { calculateAllMarkets, TeamForm, HeadToHeadStats } from '@/lib/poisson';

export const maxDuration = 60;

const TRACKED_LEAGUES = [283, 39, 140, 135, 78, 61, 2, 3, 848];
const DAYS_AHEAD = 7;
const DAYS_WITH_FULL_ANALYSIS = 3;
const MAX_FIXTURES_FULL_ANALYSIS = 4;

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

function takeLastFinished(fixtures: any[], n: number): any[] {
  const finished = fixtures.filter((f: any) => f?.fixture?.status?.short === 'FT');
  finished.sort((a: any, b: any) => new Date(b.fixture.date).getTime() - new Date(a.fixture.date).getTime());
  return finished.slice(0, n);
}

function computeH2HStats(h2hFixtures: any[]): HeadToHeadStats | undefined {
  const finished = takeLastFinished(h2hFixtures, 5);
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
  return takeLastFinished(fixtures, 5).map((f: any) => ({
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

function computeAvgCorners(values: (number | null)[]): number | null {
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
  const debugInfo: any[] = [];
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
      const dayBeforeMatch = subtractOneDay(fixtureDateStr);

      try {
        const homeStats = await fetchTeamStatistics(homeTeam.id, fixtureLeagueId, fixtureSeason);
        const awayStats = await fetchTeamStatistics(awayTeam.id, fixtureLeagueId, fixtureSeason);

        const homeForm = extractTeamForm(homeStats, 'home');
        const awayForm = extractTeamForm(awayStats, 'away');

        const h2hFixturesRaw = await fetchHeadToHead(homeTeam.id, awayTeam.id, fixtureSeason, dayBeforeMatch);
        const h2hStats = computeH2HStats(h2hFixturesRaw);
        const h2hList = extractH2HList(h2hFixturesRaw);

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

        const homeFixturesRaw = await fetchTeamFixturesBefore(homeTeam.id, fixtureSeason, dayBeforeMatch);
        const awayFixturesRaw = await fetchTeamFixturesBefore(awayTeam.id, fixtureSeason, dayBeforeMatch);

        const homeRecentFixtures = takeLastFinished(homeFixturesRaw, 5);
        const awayRecentFixtures = takeLastFinished(awayFixturesRaw, 5);

        const homeRecentForm = extractRecentForm(homeRecentFixtures, homeTeam.id);
        const awayRecentForm = extractRecentForm(awayRecentFixtures, awayTeam.id);

        const homeCornersValues: (number | null)[] = [];
        for (const f of homeRecentFixtures) {
          const stats = await fetchFixtureStatistics(f.fixture.id);
          homeCornersValues.push(extractCorners(stats, homeTeam.id));
        }
        const awayCornersValues: (number | null)[] = [];
        for (const f of awayRecentFixtures) {
          const stats = await fetchFixtureStatistics(f.fixture.id);
          awayCornersValues.push(extractCorners(stats, awayTeam.id));
        }
        const homeAvgCorners = computeAvgCorners(homeCornersValues);
        const awayAvgCorners = computeAvgCorners(awayCornersValues);

        const homeInjuriesRaw = await fetchInjuries(homeTeam.id, fixtureSeason);
        const awayInjuriesRaw = await fetchInjuries(awayTeam.id, fixtureSeason);
        const homeInjuries = extractInjuries(homeInjuriesRaw);
        const awayInjuries = extractInjuries(awayInjuriesRaw);

        debugInfo.push({
          match: homeTeam.name + ' - ' + awayTeam.name,
          season: fixtureSeason,
          dayBeforeMatch: dayBeforeMatch,
          h2hFixturesRawCount: h2hFixturesRaw.length,
          homeFixturesRawCount: homeFixturesRaw.length,
          awayFixturesRawCount: awayFixturesRaw.length,
          homeRecentFormCount: homeRecentForm.length,
          awayRecentFormCount: awayRecentForm.length,
          homeAvgCorners: homeAvgCorners,
          awayAvgCorners: awayAvgCorners,
          homeInjuriesCount: homeInjuries.length,
          awayInjuriesCount: awayInjuries.length,
        });

        await supabaseAdmin.from('match_analysis').upsert(
          {
            match_id: matchRow.id,
            home_recent_form: homeRecentForm,
            away_recent_form: awayRecentForm,
            h2h_matches: h2hList,
            home_avg_corners: homeAvgCorners,
            away_avg_corners: awayAvgCorners,
            home_injuries: homeInjuries,
            away_injuries: awayInjuries,
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
    processed: totalProcessed,
    withAnalysis: totalWithAnalysis,
    fullAnalysisBudgetUsed: fullAnalysisBudgetUsed,
    days: summary,
    apiErrors: allApiErrors.slice(0, 15),
    debugInfo: debugInfo,
  });
}
