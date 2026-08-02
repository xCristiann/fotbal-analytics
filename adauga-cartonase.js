#!/usr/bin/env node
// Adauga piata de cartonase (fara cereri API suplimentare - refolosim
// acelasi raspuns de la care luam cornerele). Face si limita de
// meciuri analizate configurabila din Vercel (env var), ca sa o poti
// creste singur dupa ce treci pe planul platit.

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

// Configurabil din Vercel (Environment Variables), fara sa mai fie
// nevoie de alt cod. Dupa ce treci pe plan platit, poti scadea
// API_REQUEST_DELAY_MS (limita per-minut e mult mai mare).
const REQUEST_DELAY_MS = Number(process.env.API_REQUEST_DELAY_MS || '700');

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

console.log('lib/apiFootball.ts actualizat. Continui...');

writeFile('lib/poisson.ts', `// Model de probabilitate: Poisson + Dixon-Coles pentru scoruri mici,
// medii de goluri specifice per liga, piata de cornere si cartonase,
// integrare H2H.

export interface TeamForm {
  avgGoalsScored: number;
  avgGoalsConceded: number;
}

export interface HeadToHeadStats {
  matchesCount: number;
  bttsRate: number;
  over25Rate: number;
}

export interface LeagueAverages {
  avgHomeGoals: number;
  avgAwayGoals: number;
}

export interface MarketProbability {
  market: string;
  selection: string;
  label: string;
  probability: number;
  fairOdds: number;
}

function factorial(n: number): number {
  let result = 1;
  for (let i = 2; i <= n; i++) {
    result *= i;
  }
  return result;
}

export function poissonProbability(lambda: number, k: number): number {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

const DEFAULT_LEAGUE_AVG_HOME_GOALS = 1.45;
const DEFAULT_LEAGUE_AVG_AWAY_GOALS = 1.15;
const MAX_GOALS = 8;
const DIXON_COLES_RHO = -0.13;

function dixonColesTau(x: number, y: number, lambdaHome: number, lambdaAway: number, rho: number): number {
  if (x === 0 && y === 0) return 1 - lambdaHome * lambdaAway * rho;
  if (x === 0 && y === 1) return 1 + lambdaHome * rho;
  if (x === 1 && y === 0) return 1 + lambdaAway * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

export function calculateExpectedGoals(
  home: TeamForm,
  away: TeamForm,
  leagueAvg?: LeagueAverages
): { lambdaHome: number; lambdaAway: number } {
  const avgHome = leagueAvg?.avgHomeGoals ?? DEFAULT_LEAGUE_AVG_HOME_GOALS;
  const avgAway = leagueAvg?.avgAwayGoals ?? DEFAULT_LEAGUE_AVG_AWAY_GOALS;

  const homeAttackStrength = home.avgGoalsScored / avgHome;
  const homeDefenseWeakness = home.avgGoalsConceded / avgAway;
  const awayAttackStrength = away.avgGoalsScored / avgAway;
  const awayDefenseWeakness = away.avgGoalsConceded / avgHome;

  const lambdaHome = homeAttackStrength * awayDefenseWeakness * avgHome;
  const lambdaAway = awayAttackStrength * homeDefenseWeakness * avgAway;

  return { lambdaHome, lambdaAway };
}

export function calculateAllMarkets(
  home: TeamForm,
  away: TeamForm,
  h2h?: HeadToHeadStats,
  leagueAvg?: LeagueAverages
): MarketProbability[] {
  const { lambdaHome, lambdaAway } = calculateExpectedGoals(home, away, leagueAvg);

  const scoreMatrix: number[][] = [];
  let totalMass = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    scoreMatrix[h] = [];
    for (let a = 0; a <= MAX_GOALS; a++) {
      let p = poissonProbability(lambdaHome, h) * poissonProbability(lambdaAway, a);
      p *= dixonColesTau(h, a, lambdaHome, lambdaAway, DIXON_COLES_RHO);
      scoreMatrix[h][a] = p;
      totalMass += p;
    }
  }

  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      scoreMatrix[h][a] = scoreMatrix[h][a] / totalMass;
    }
  }

  let pHomeWin = 0;
  let pDraw = 0;
  let pAwayWin = 0;
  let pBttsYes = 0;
  let pOver25 = 0;

  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = scoreMatrix[h][a];
      if (h > a) pHomeWin += p;
      else if (h === a) pDraw += p;
      else pAwayWin += p;

      if (h >= 1 && a >= 1) pBttsYes += p;
      if (h + a > 2.5) pOver25 += p;
    }
  }

  if (h2h && h2h.matchesCount >= 3) {
    const h2hWeight = 0.25;
    pBttsYes = pBttsYes * (1 - h2hWeight) + h2h.bttsRate * h2hWeight;
    pOver25 = pOver25 * (1 - h2hWeight) + h2h.over25Rate * h2hWeight;
  }

  const pBttsNo = 1 - pBttsYes;
  const pUnder25Final = 1 - pOver25;
  const pDoubleChance1X = pHomeWin + pDraw;
  const pDoubleChanceX2 = pDraw + pAwayWin;
  const pDoubleChance12 = pHomeWin + pAwayWin;

  const markets: MarketProbability[] = [
    { market: '1X2', selection: 'HOME', label: 'Victorie gazde', probability: pHomeWin, fairOdds: 1 / pHomeWin },
    { market: '1X2', selection: 'DRAW', label: 'Egal', probability: pDraw, fairOdds: 1 / pDraw },
    { market: '1X2', selection: 'AWAY', label: 'Victorie oaspeti', probability: pAwayWin, fairOdds: 1 / pAwayWin },
    { market: 'BTTS', selection: 'YES', label: 'Ambele echipe marcheaza', probability: pBttsYes, fairOdds: 1 / pBttsYes },
    { market: 'BTTS', selection: 'NO', label: 'Nu marcheaza ambele echipe', probability: pBttsNo, fairOdds: 1 / pBttsNo },
    { market: 'OU25', selection: 'OVER', label: 'Peste 2.5 goluri', probability: pOver25, fairOdds: 1 / pOver25 },
    { market: 'OU25', selection: 'UNDER', label: 'Sub 2.5 goluri', probability: pUnder25Final, fairOdds: 1 / pUnder25Final },
    { market: 'DC', selection: '1X', label: 'Dubla sansa 1X', probability: pDoubleChance1X, fairOdds: 1 / pDoubleChance1X },
    { market: 'DC', selection: 'X2', label: 'Dubla sansa X2', probability: pDoubleChanceX2, fairOdds: 1 / pDoubleChanceX2 },
    { market: 'DC', selection: '12', label: 'Dubla sansa 12', probability: pDoubleChance12, fairOdds: 1 / pDoubleChance12 },
  ];

  return markets.sort((a, b) => b.probability - a.probability);
}

const CORNER_THRESHOLDS = [8.5, 9.5, 10.5];
const CARD_THRESHOLDS = [3.5, 4.5, 5.5];

function calculateTotalOverUnderMarkets(
  homeAvg: number | null,
  awayAvg: number | null,
  thresholds: number[],
  marketName: string,
  unitLabel: string
): MarketProbability[] {
  if (homeAvg === null || awayAvg === null) return [];

  const lambdaTotal = homeAvg + awayAvg;
  const markets: MarketProbability[] = [];

  for (const threshold of thresholds) {
    const kMax = Math.floor(threshold);
    let pUnder = 0;
    for (let k = 0; k <= kMax; k++) {
      pUnder += poissonProbability(lambdaTotal, k);
    }
    pUnder = Math.max(0.01, Math.min(0.99, pUnder));
    const pOver = 1 - pUnder;

    markets.push({
      market: marketName,
      selection: 'OVER_' + threshold,
      label: 'Peste ' + threshold + ' ' + unitLabel + ' (total)',
      probability: pOver,
      fairOdds: 1 / pOver,
    });
    markets.push({
      market: marketName,
      selection: 'UNDER_' + threshold,
      label: 'Sub ' + threshold + ' ' + unitLabel + ' (total)',
      probability: pUnder,
      fairOdds: 1 / pUnder,
    });
  }

  return markets;
}

// Model Poisson pentru totalul de cornere (suma ambelor echipe),
// bazat pe media reala din ultimele 5 meciuri ale fiecarei echipe.
export function calculateCornerMarkets(homeAvgCorners: number | null, awayAvgCorners: number | null): MarketProbability[] {
  return calculateTotalOverUnderMarkets(homeAvgCorners, awayAvgCorners, CORNER_THRESHOLDS, 'CORNERS', 'cornere');
}

// Acelasi model, pentru cartonase (galbene + rosii insumate).
export function calculateCardMarkets(homeAvgCards: number | null, awayAvgCards: number | null): MarketProbability[] {
  return calculateTotalOverUnderMarkets(homeAvgCards, awayAvgCards, CARD_THRESHOLDS, 'CARDS', 'cartonase');
}
`);

console.log('lib/poisson.ts actualizat. Continui cu route.ts...');

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
import { calculateAllMarkets, calculateCornerMarkets, calculateCardMarkets, TeamForm, HeadToHeadStats, LeagueAverages } from '@/lib/poisson';

export const maxDuration = 60;

const TRACKED_LEAGUES = [283, 39, 140, 135, 78, 61, 2, 3, 848];
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
`);

console.log('\nGata! Acum ruleaza:');
console.log('  git add .');
console.log('  git commit -m "Adauga piata de cartonase + limite configurabile din Vercel"');
console.log('  git push');

writeFile('app/match/[id]/page.tsx', `'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';

interface Prediction {
  market: string;
  selection: string;
  label: string;
  probability: number;
  fair_odds: number;
}

interface OddRow {
  bookmaker: string;
  market: string;
  selection: string;
  odd_value: number;
}

interface MatchDetail {
  home_team_name: string;
  away_team_name: string;
  kickoff_utc: string;
}

interface FormEntry {
  date: string;
  opponent: string;
  venue: string;
  scoreFor: number;
  scoreAgainst: number;
  result: string;
}

interface H2HEntry {
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
}

interface InjuryEntry {
  playerName: string;
  reason: string;
}

interface MatchAnalysis {
  home_recent_form: FormEntry[] | null;
  away_recent_form: FormEntry[] | null;
  h2h_matches: H2HEntry[] | null;
  home_avg_corners: number | null;
  away_avg_corners: number | null;
  home_avg_cards: number | null;
  away_avg_cards: number | null;
  home_injuries: InjuryEntry[] | null;
  away_injuries: InjuryEntry[] | null;
}

function probabilityBadgeClass(prob: number): string {
  if (prob >= 0.9) return 'bg-emerald-500';
  if (prob >= 0.8) return 'bg-lime-500';
  if (prob >= 0.7) return 'bg-yellow-500';
  return 'bg-slate-600';
}

function resultBadgeClass(result: string): string {
  if (result === 'W') return 'bg-emerald-500';
  if (result === 'L') return 'bg-red-500';
  return 'bg-slate-500';
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return d.getDate().toString().padStart(2, '0') + '.' + (d.getMonth() + 1).toString().padStart(2, '0') + '.' + d.getFullYear();
}

export default function MatchDetailPage() {
  const params = useParams();
  const matchId = params.id as string;

  const [match, setMatch] = useState<MatchDetail | null>(null);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [odds, setOdds] = useState<OddRow[]>([]);
  const [analysis, setAnalysis] = useState<MatchAnalysis | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      setLoading(true);

      const { data: matchData } = await supabaseBrowser
        .from('matches')
        .select('home_team_name, away_team_name, kickoff_utc')
        .eq('id', matchId)
        .single();

      const { data: predictionsData } = await supabaseBrowser
        .from('predictions')
        .select('market, selection, label, probability, fair_odds')
        .eq('match_id', matchId)
        .order('probability', { ascending: false });

      const { data: oddsData } = await supabaseBrowser
        .from('odds')
        .select('bookmaker, market, selection, odd_value')
        .eq('match_id', matchId);

      const { data: analysisData } = await supabaseBrowser
        .from('match_analysis')
        .select('home_recent_form, away_recent_form, h2h_matches, home_avg_corners, away_avg_corners, home_avg_cards, away_avg_cards, home_injuries, away_injuries')
        .eq('match_id', matchId)
        .maybeSingle();

      setMatch(matchData);
      setPredictions(predictionsData || []);
      setOdds(oddsData || []);
      setAnalysis(analysisData || null);
      setLoading(false);
    }

    loadData();
  }, [matchId]);

  function findBestOdd(market: string, selection: string): number | null {
    const relevant = odds.filter((o) => o.market === market && o.selection === selection);
    if (relevant.length === 0) return null;
    return Math.max(...relevant.map((o) => o.odd_value));
  }

  const top3 = predictions.slice(0, 3);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 px-4 py-8">
      <div className="max-w-2xl mx-auto">
        {loading && <p className="text-slate-400 text-sm">Se incarca...</p>}

        {!loading && match && (
          <>
            <h1 className="text-xl font-semibold mb-1">
              {match.home_team_name} - {match.away_team_name}
            </h1>
            <p className="text-sm text-slate-500 mb-6">
              {new Date(match.kickoff_utc).toLocaleString('ro-RO')}
            </p>

            {predictions.length === 0 && (
              <p className="text-slate-500 text-sm mb-6">
                Analiza completa nu a fost inca facuta pentru acest meci (se completeaza treptat, la urmatoarele sincronizari).
              </p>
            )}

            {predictions.length > 0 && (
              <>
                <h2 className="text-sm font-semibold text-slate-400 mb-3 uppercase tracking-wide">
                  Top 3 cele mai probabile
                </h2>
                <div className="space-y-2 mb-8">
                  {top3.map((p) => (
                    <div
                      key={p.market + p.selection}
                      className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-lg px-4 py-3"
                    >
                      <span className="text-sm">{p.label}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-slate-400">
                          cota reala: {findBestOdd(p.market, p.selection) ?? '-'}
                        </span>
                        <span className={'text-xs font-semibold text-white px-2 py-1 rounded ' + probabilityBadgeClass(p.probability)}>
                          {Math.round(p.probability * 100)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <h2 className="text-sm font-semibold text-slate-400 mb-3 uppercase tracking-wide">
                  Toate pietele
                </h2>
                <div className="space-y-1 mb-8">
                  {predictions.map((p) => (
                    <div
                      key={p.market + p.selection + '-all'}
                      className="flex items-center justify-between text-sm px-4 py-2 border-b border-slate-900"
                    >
                      <span className="text-slate-300">{p.label}</span>
                      <span className="text-slate-500">{Math.round(p.probability * 100)}%</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {analysis && (analysis.home_recent_form || analysis.away_recent_form) && (
              <>
                <h2 className="text-sm font-semibold text-slate-400 mb-3 uppercase tracking-wide">
                  Forma recenta (ultimele 5 meciuri)
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
                  <div>
                    <p className="text-xs text-slate-500 mb-2">{match.home_team_name}</p>
                    <div className="space-y-1">
                      {(analysis.home_recent_form || []).map((f, i) => (
                        <div key={i} className="flex items-center justify-between text-xs bg-slate-900 border border-slate-800 rounded px-3 py-2">
                          <span className={'w-5 h-5 flex items-center justify-center rounded-full text-white font-bold ' + resultBadgeClass(f.result)}>{f.result}</span>
                          <span className="text-slate-400 flex-1 px-2 truncate">vs {f.opponent}</span>
                          <span className="text-slate-500">{f.scoreFor}-{f.scoreAgainst}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-2">{match.away_team_name}</p>
                    <div className="space-y-1">
                      {(analysis.away_recent_form || []).map((f, i) => (
                        <div key={i} className="flex items-center justify-between text-xs bg-slate-900 border border-slate-800 rounded px-3 py-2">
                          <span className={'w-5 h-5 flex items-center justify-center rounded-full text-white font-bold ' + resultBadgeClass(f.result)}>{f.result}</span>
                          <span className="text-slate-400 flex-1 px-2 truncate">vs {f.opponent}</span>
                          <span className="text-slate-500">{f.scoreFor}-{f.scoreAgainst}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}

            {analysis && analysis.h2h_matches && analysis.h2h_matches.length > 0 && (
              <>
                <h2 className="text-sm font-semibold text-slate-400 mb-3 uppercase tracking-wide">
                  Ultimele confruntari directe
                </h2>
                <div className="space-y-1 mb-8">
                  {analysis.h2h_matches.map((h, i) => (
                    <div key={i} className="flex items-center justify-between text-xs bg-slate-900 border border-slate-800 rounded px-3 py-2">
                      <span className="text-slate-500">{formatShortDate(h.date)}</span>
                      <span className="text-slate-300">{h.homeTeam} {h.homeGoals} - {h.awayGoals} {h.awayTeam}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {analysis && (analysis.home_avg_corners !== null || analysis.away_avg_corners !== null || analysis.home_avg_cards !== null || analysis.away_avg_cards !== null) && (
              <>
                <h2 className="text-sm font-semibold text-slate-400 mb-3 uppercase tracking-wide">
                  Medii (ultimele 5 meciuri)
                </h2>
                <div className="grid grid-cols-2 gap-4 mb-8">
                  <div className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-3">
                    <p className="text-xs text-slate-500 mb-2">{match.home_team_name}</p>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-slate-400">Cornere</span>
                      <span className="font-semibold">{analysis.home_avg_corners !== null ? analysis.home_avg_corners.toFixed(1) : '-'}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Cartonase</span>
                      <span className="font-semibold">{analysis.home_avg_cards !== null ? analysis.home_avg_cards.toFixed(1) : '-'}</span>
                    </div>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-3">
                    <p className="text-xs text-slate-500 mb-2">{match.away_team_name}</p>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-slate-400">Cornere</span>
                      <span className="font-semibold">{analysis.away_avg_corners !== null ? analysis.away_avg_corners.toFixed(1) : '-'}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Cartonase</span>
                      <span className="font-semibold">{analysis.away_avg_cards !== null ? analysis.away_avg_cards.toFixed(1) : '-'}</span>
                    </div>
                  </div>
                </div>
              </>
            )}

            {analysis && ((analysis.home_injuries && analysis.home_injuries.length > 0) || (analysis.away_injuries && analysis.away_injuries.length > 0)) && (
              <>
                <h2 className="text-sm font-semibold text-slate-400 mb-3 uppercase tracking-wide">
                  Accidentari
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
                  <div>
                    <p className="text-xs text-slate-500 mb-2">{match.home_team_name}</p>
                    <div className="space-y-1">
                      {(analysis.home_injuries || []).length === 0 && <p className="text-xs text-slate-600">Fara raportari</p>}
                      {(analysis.home_injuries || []).map((inj, i) => (
                        <div key={i} className="text-xs bg-slate-900 border border-slate-800 rounded px-3 py-2">
                          <span className="text-slate-300">{inj.playerName}</span>
                          <span className="text-slate-500"> - {inj.reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-2">{match.away_team_name}</p>
                    <div className="space-y-1">
                      {(analysis.away_injuries || []).length === 0 && <p className="text-xs text-slate-600">Fara raportari</p>}
                      {(analysis.away_injuries || []).map((inj, i) => (
                        <div key={i} className="text-xs bg-slate-900 border border-slate-800 rounded px-3 py-2">
                          <span className="text-slate-300">{inj.playerName}</span>
                          <span className="text-slate-500"> - {inj.reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
`);

console.log('\nGata complet!');
console.log('Acum ruleaza:');
console.log('  git add .');
console.log('  git commit -m "Adauga piata de cartonase + limite configurabile din Vercel"');
console.log('  git push');
