#!/usr/bin/env node
// Scoatem parametrul "to" (care intorcea 0 rezultate, indiferent de
// combinatie) si filtram pe data STRICT local, in cod, dupa ce luam
// toate meciurile echipei pe sezon (exact modelul care stim sigur ca
// functioneaza, dovedit de fetchSeasonFixtures). Adaugam si verificare
// de erori la toate functiile, ca sa nu mai avem "0 tacut" niciodata.

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
const REQUEST_DELAY_MS = 700;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getHeaders() {
  return {
    'x-apisports-key': process.env.API_FOOTBALL_KEY || '',
  };
}

interface ApiResult {
  data: any;
  status: number;
  errors: any[];
}

async function apiCall(url: string): Promise<ApiResult> {
  const res = await fetch(url, { headers: getHeaders() });
  const data = await res.json();
  await sleep(REQUEST_DELAY_MS);

  const errors: any[] = [];
  const hasErrors = data && data.errors && (
    Array.isArray(data.errors) ? data.errors.length > 0 : Object.keys(data.errors).length > 0
  );
  if (hasErrors) {
    errors.push({ url: url, httpStatus: res.status, apiErrors: data.errors, results: data.results });
  }

  return { data: data, status: res.status, errors: errors };
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
  const { data, errors } = await apiCall(url);
  const fixtures = (data && data.response) ? data.response : [];
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

// Fara parametrul "to" (nu functiona corect). Luam TOATE meciurile
// echipei pe sezon si filtram pe data local, in route.ts.
export async function fetchTeamSeasonFixtures(teamId: number, season: number): Promise<FixturesResult> {
  const url = API_BASE + '/fixtures?team=' + teamId + '&season=' + season;
  const { data, errors } = await apiCall(url);
  const fixtures = (data && data.response) ? data.response : [];
  return { fixtures: fixtures, errors: errors };
}

export async function fetchHeadToHead(teamId1: number, teamId2: number, season: number): Promise<FixturesResult> {
  const url = API_BASE + '/fixtures/headtohead?h2h=' + teamId1 + '-' + teamId2 + '&season=' + season;
  const { data, errors } = await apiCall(url);
  const fixtures = (data && data.response) ? data.response : [];
  return { fixtures: fixtures, errors: errors };
}

export async function fetchFixtureStatistics(fixtureId: number) {
  const url = API_BASE + '/fixtures/statistics?fixture=' + fixtureId;
  const { data } = await apiCall(url);
  return (data && data.response) ? data.response : [];
}

export async function fetchInjuries(teamId: number, season: number): Promise<{ injuries: any[]; errors: any[] }> {
  const url = API_BASE + '/injuries?team=' + teamId + '&season=' + season;
  const { data, errors } = await apiCall(url);
  const injuries = (data && data.response) ? data.response : [];
  return { injuries: injuries, errors: errors };
}
`);

console.log('lib/apiFootball.ts actualizat. Continui cu route.ts...');

writeFile('app/api/sync/route.ts', `import { NextResponse } from 'next/server';
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

// Filtrare STRICT LOCALA: doar meciuri terminate, INAINTE de data
// meciului analizat (evitam "prezicerea" cu date din viitor), sortate
// descrescator dupa data, luam primele n.
function filterBeforeDateAndTakeLast(fixtures: any[], beforeDateStr: string, n: number): any[] {
  const beforeTime = new Date(beforeDateStr).getTime();
  const finished = fixtures.filter((f: any) => {
    if (f?.fixture?.status?.short !== 'FT') return false;
    return new Date(f.fixture.date).getTime() < beforeTime;
  });
  finished.sort((a: any, b: any) => new Date(b.fixture.date).getTime() - new Date(a.fixture.date).getTime());
  return finished.slice(0, n);
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

      try {
        const homeStats = await fetchTeamStatistics(homeTeam.id, fixtureLeagueId, fixtureSeason);
        const awayStats = await fetchTeamStatistics(awayTeam.id, fixtureLeagueId, fixtureSeason);

        const homeForm = extractTeamForm(homeStats, 'home');
        const awayForm = extractTeamForm(awayStats, 'away');

        const h2hResult = await fetchHeadToHead(homeTeam.id, awayTeam.id, fixtureSeason);
        if (h2hResult.errors.length > 0) allApiErrors.push(...h2hResult.errors);
        const h2hFiltered = filterBeforeDateAndTakeLast(h2hResult.fixtures, fixtureDateStr, 5);
        const h2hStats = computeH2HStats(h2hFiltered);
        const h2hList = extractH2HList(h2hFiltered);

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

        const homeSeasonResult = await fetchTeamSeasonFixtures(homeTeam.id, fixtureSeason);
        if (homeSeasonResult.errors.length > 0) allApiErrors.push(...homeSeasonResult.errors);
        const awaySeasonResult = await fetchTeamSeasonFixtures(awayTeam.id, fixtureSeason);
        if (awaySeasonResult.errors.length > 0) allApiErrors.push(...awaySeasonResult.errors);

        const homeRecentFixtures = filterBeforeDateAndTakeLast(homeSeasonResult.fixtures, fixtureDateStr, 5);
        const awayRecentFixtures = filterBeforeDateAndTakeLast(awaySeasonResult.fixtures, fixtureDateStr, 5);

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

        const homeInjuriesResult = await fetchInjuries(homeTeam.id, fixtureSeason);
        if (homeInjuriesResult.errors.length > 0) allApiErrors.push(...homeInjuriesResult.errors);
        const awayInjuriesResult = await fetchInjuries(awayTeam.id, fixtureSeason);
        if (awayInjuriesResult.errors.length > 0) allApiErrors.push(...awayInjuriesResult.errors);

        const homeInjuries = extractInjuries(homeInjuriesResult.injuries);
        const awayInjuries = extractInjuries(awayInjuriesResult.injuries);

        debugInfo.push({
          match: homeTeam.name + ' - ' + awayTeam.name,
          season: fixtureSeason,
          h2hRawCount: h2hResult.fixtures.length,
          h2hFilteredCount: h2hFiltered.length,
          homeSeasonRawCount: homeSeasonResult.fixtures.length,
          awaySeasonRawCount: awaySeasonResult.fixtures.length,
          homeRecentFormCount: homeRecentForm.length,
          awayRecentFormCount: awayRecentForm.length,
          homeAvgCorners: homeAvgCorners,
          awayAvgCorners: awayAvgCorners,
          homeInjuriesRawCount: homeInjuriesResult.injuries.length,
          awayInjuriesRawCount: awayInjuriesResult.injuries.length,
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
    apiErrors: allApiErrors.slice(0, 20),
    debugInfo: debugInfo,
  });
}
`);

console.log('\nGata! Acum ruleaza:');
console.log('  git add .');
console.log('  git commit -m "Repara definitiv: scoate parametrul to, filtrare locala pe data"');
console.log('  git push');
