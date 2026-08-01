#!/usr/bin/env node
// Adauga analiza detaliata per meci: ultimele 5 confruntari directe,
// ultimele 5 meciuri (forma) ale fiecarei echipe, cornere medii,
// jucatori accidentati. Afiseaza tot pe pagina meciului.

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
  const url = API_BASE + '/fixtures/headtohead?h2h=' + teamId1 + '-' + teamId2 + '&last=5';
  const { data } = await apiCall(url);
  return (data && data.response) ? data.response : [];
}

export async function fetchTeamRecentFixtures(teamId: number, last: number) {
  const url = API_BASE + '/fixtures?team=' + teamId + '&last=' + last;
  const { data } = await apiCall(url);
  return (data && data.response) ? data.response : [];
}

export async function fetchFixtureStatistics(fixtureId: number) {
  const url = API_BASE + '/fixtures/statistics?fixture=' + fixtureId;
  const { data } = await apiCall(url);
  return (data && data.response) ? data.response : [];
}

export async function fetchInjuries(teamId: number, season: number) {
  const url = API_BASE + '/injuries?team=' + teamId + '&season=' + season;
  const { data } = await apiCall(url);
  return (data && data.response) ? data.response : [];
}
`);

console.log('Pas 1/2 scris (lib/apiFootball.ts). Continui cu route.ts si pagina de meci...');

writeFile('app/api/sync/route.ts', `import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  fetchSeasonFixtures,
  fetchTeamStatistics,
  fetchOddsByFixture,
  fetchHeadToHead,
  fetchTeamRecentFixtures,
  fetchFixtureStatistics,
  fetchInjuries,
  inferSeason,
} from '@/lib/apiFootball';
import { calculateAllMarkets, TeamForm, HeadToHeadStats } from '@/lib/poisson';

export const maxDuration = 60;

const TRACKED_LEAGUES = [283, 39, 140, 135, 78, 61, 2, 3, 848];
const DAYS_AHEAD = 7;
const DAYS_WITH_FULL_ANALYSIS = 3;

// Analiza completa (forma, cornere, accidentari) e mult mai scumpa in
// cereri API (~18 per meci) decat analiza de baza (~4 per meci). Limita
// scade corespunzator, ca sa ramanem sub timpul maxim de executie.
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

function extractRecentForm(fixtures: any[], teamId: number): any[] {
  return fixtures
    .filter((f: any) => f?.fixture?.status?.short === 'FT')
    .map((f: any) => {
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
  return fixtures
    .filter((f: any) => f?.fixture?.status?.short === 'FT')
    .slice(0, 5)
    .map((f: any) => ({
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
        const h2hList = extractH2HList(h2hFixtures);

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

        const homeRecentFixtures = await fetchTeamRecentFixtures(homeTeam.id, 5);
        const awayRecentFixtures = await fetchTeamRecentFixtures(awayTeam.id, 5);

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
  });
}
`);

console.log('Pas 2/3 scris (route.ts). Continui cu pagina de meci...');

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
        .select('home_recent_form, away_recent_form, h2h_matches, home_avg_corners, away_avg_corners, home_injuries, away_injuries')
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

            {analysis && (analysis.home_avg_corners !== null || analysis.away_avg_corners !== null) && (
              <>
                <h2 className="text-sm font-semibold text-slate-400 mb-3 uppercase tracking-wide">
                  Cornere medii (ultimele 5 meciuri)
                </h2>
                <div className="grid grid-cols-2 gap-4 mb-8">
                  <div className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-3 text-center">
                    <p className="text-xs text-slate-500 mb-1">{match.home_team_name}</p>
                    <p className="text-lg font-semibold">{analysis.home_avg_corners !== null ? analysis.home_avg_corners.toFixed(1) : '-'}</p>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-3 text-center">
                    <p className="text-xs text-slate-500 mb-1">{match.away_team_name}</p>
                    <p className="text-lg font-semibold">{analysis.away_avg_corners !== null ? analysis.away_avg_corners.toFixed(1) : '-'}</p>
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

console.log('\nGata! Acum ruleaza:');
console.log('  git add .');
console.log('  git commit -m "Adauga analiza completa: forma, H2H, cornere, accidentari"');
console.log('  git push');
