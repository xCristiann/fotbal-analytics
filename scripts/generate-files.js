#!/usr/bin/env node

/**
 * Genereaza toate fisierele sursa ale platformei.
 * Ruleaza cu Node.js (fs.writeFileSync + encoding utf8) pentru a evita
 * problemele de corupere a caracterelor speciale intalnite anterior
 * cand scrierea se facea din PowerShell.
 */

const fs = require('fs');
const path = require('path');

function writeFile(relativePath, content) {
  const fullPath = path.join(__dirname, '..', relativePath);
  const dir = path.dirname(fullPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fullPath, content, { encoding: 'utf8' });
  console.log('Creat: ' + relativePath);
}

// ================================================================
// lib/poisson.ts - ALGORITMUL DE PROBABILITATE
// ================================================================
writeFile('lib/poisson.ts', `// Model de probabilitate bazat pe distributia Poisson.
// Calculeaza sansele pentru principalele piete de pariuri, pornind
// de la golurile medii marcate / incasate de fiecare echipa.
//
// Important: acest model estimeaza probabilitati reale, nu "sanse
// garantate". O piata cu probabilitate 90%+ va aparea rar pe piete
// cu cota mare (ex. BTTS) si des pe piete cu cota mica (ex. dubla
// sansa). Asta e asteptat si corect din punct de vedere statistic.

export interface TeamForm {
  avgGoalsScored: number;
  avgGoalsConceded: number;
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

function poissonProbability(lambda: number, k: number): number {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

// Medii de referinta pentru golurile marcate in fotbalul european.
// Le poti recalibra ulterior pe baza datelor istorice reale.
const LEAGUE_AVG_HOME_GOALS = 1.45;
const LEAGUE_AVG_AWAY_GOALS = 1.15;
const MAX_GOALS = 8;

export function calculateExpectedGoals(
  home: TeamForm,
  away: TeamForm
): { lambdaHome: number; lambdaAway: number } {
  const homeAttackStrength = home.avgGoalsScored / LEAGUE_AVG_HOME_GOALS;
  const homeDefenseWeakness = home.avgGoalsConceded / LEAGUE_AVG_AWAY_GOALS;
  const awayAttackStrength = away.avgGoalsScored / LEAGUE_AVG_AWAY_GOALS;
  const awayDefenseWeakness = away.avgGoalsConceded / LEAGUE_AVG_HOME_GOALS;

  const lambdaHome = homeAttackStrength * awayDefenseWeakness * LEAGUE_AVG_HOME_GOALS;
  const lambdaAway = awayAttackStrength * homeDefenseWeakness * LEAGUE_AVG_AWAY_GOALS;

  return { lambdaHome, lambdaAway };
}

export function calculateAllMarkets(home: TeamForm, away: TeamForm): MarketProbability[] {
  const { lambdaHome, lambdaAway } = calculateExpectedGoals(home, away);

  const scoreMatrix: number[][] = [];
  for (let h = 0; h <= MAX_GOALS; h++) {
    scoreMatrix[h] = [];
    for (let a = 0; a <= MAX_GOALS; a++) {
      scoreMatrix[h][a] = poissonProbability(lambdaHome, h) * poissonProbability(lambdaAway, a);
    }
  }

  let pHomeWin = 0;
  let pDraw = 0;
  let pAwayWin = 0;
  let pBttsYes = 0;
  let pOver25 = 0;
  let pUnder25 = 0;

  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = scoreMatrix[h][a];
      if (h > a) pHomeWin += p;
      else if (h === a) pDraw += p;
      else pAwayWin += p;

      if (h >= 1 && a >= 1) pBttsYes += p;

      if (h + a > 2.5) pOver25 += p;
      else pUnder25 += p;
    }
  }

  const pBttsNo = 1 - pBttsYes;
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
    { market: 'OU25', selection: 'UNDER', label: 'Sub 2.5 goluri', probability: pUnder25, fairOdds: 1 / pUnder25 },
    { market: 'DC', selection: '1X', label: 'Dubla sansa 1X', probability: pDoubleChance1X, fairOdds: 1 / pDoubleChance1X },
    { market: 'DC', selection: 'X2', label: 'Dubla sansa X2', probability: pDoubleChanceX2, fairOdds: 1 / pDoubleChanceX2 },
    { market: 'DC', selection: '12', label: 'Dubla sansa 12', probability: pDoubleChance12, fairOdds: 1 / pDoubleChance12 },
  ];

  return markets.sort((a, b) => b.probability - a.probability);
}
`);

// ================================================================
// lib/supabase.ts
// ================================================================
writeFile('lib/supabase.ts', `import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Folosit pe server (cron, API routes) - acces complet, ocoleste RLS
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

// Folosit in browser - doar citire, respecta RLS
export const supabaseBrowser = createClient(supabaseUrl, supabaseAnonKey);
`);

// ================================================================
// lib/apiFootball.ts
// ================================================================
writeFile('lib/apiFootball.ts', `// Client minimal pentru API-Football (api-sports.io / api-football.com)
// Documentatie: https://www.api-football.com/documentation-v3

const API_BASE = 'https://v3.football.api-sports.io';

function getHeaders() {
  return {
    'x-apisports-key': process.env.API_FOOTBALL_KEY || '',
  };
}

export async function fetchFixturesByDate(date: string, leagueIds: number[]) {
  const results: any[] = [];
  const season = new Date(date).getFullYear();

  for (const leagueId of leagueIds) {
    const url = API_BASE + '/fixtures?date=' + date + '&league=' + leagueId + '&season=' + season;
    const res = await fetch(url, { headers: getHeaders() });
    const data = await res.json();
    if (data && data.response) {
      results.push(...data.response);
    }
  }
  return results;
}

export async function fetchTeamStatistics(teamId: number, leagueId: number, season: number) {
  const url = API_BASE + '/teams/statistics?team=' + teamId + '&league=' + leagueId + '&season=' + season;
  const res = await fetch(url, { headers: getHeaders() });
  const data = await res.json();
  return data.response;
}

export async function fetchOddsByFixture(fixtureId: number) {
  const url = API_BASE + '/odds?fixture=' + fixtureId;
  const res = await fetch(url, { headers: getHeaders() });
  const data = await res.json();
  return data.response;
}
`);

// ================================================================
// app/api/sync/route.ts - cron zilnic
// ================================================================
writeFile('app/api/sync/route.ts', `import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { fetchFixturesByDate, fetchTeamStatistics, fetchOddsByFixture } from '@/lib/apiFootball';
import { calculateAllMarkets, TeamForm } from '@/lib/poisson';

// Ligile urmarite in faza 1. Poti adauga/scoate ID-uri de liga.
// 283 = Liga 1 Romania, 39 = Premier League, 140 = La Liga,
// 135 = Serie A, 78 = Bundesliga, 61 = Ligue 1
const TRACKED_LEAGUES = [283, 39, 140, 135, 78, 61];

function extractTeamForm(stats: any): TeamForm {
  const played = stats?.fixtures?.played?.total || 1;
  const goalsScored = stats?.goals?.for?.total?.total || 0;
  const goalsConceded = stats?.goals?.against?.total?.total || 0;

  return {
    avgGoalsScored: goalsScored / played,
    avgGoalsConceded: goalsConceded / played,
  };
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== 'Bearer ' + process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Neautorizat' }, { status: 401 });
  }

  const today = new Date().toISOString().split('T')[0];
  const fixtures = await fetchFixturesByDate(today, TRACKED_LEAGUES);

  let processed = 0;

  for (const fixture of fixtures) {
    const fixtureId = fixture.fixture.id;
    const leagueId = fixture.league.id;
    const season = fixture.league.season;
    const homeTeam = fixture.teams.home;
    const awayTeam = fixture.teams.away;

    await supabaseAdmin.from('teams').upsert(
      [
        { api_football_id: homeTeam.id, name: homeTeam.name, league_id: leagueId },
        { api_football_id: awayTeam.id, name: awayTeam.name, league_id: leagueId },
      ],
      { onConflict: 'api_football_id' }
    );

    const { data: matchRow } = await supabaseAdmin
      .from('matches')
      .upsert(
        {
          api_football_id: fixtureId,
          league_id: leagueId,
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

    const homeStats = await fetchTeamStatistics(homeTeam.id, leagueId, season);
    const awayStats = await fetchTeamStatistics(awayTeam.id, leagueId, season);

    const homeForm = extractTeamForm(homeStats);
    const awayForm = extractTeamForm(awayStats);

    const markets = calculateAllMarkets(homeForm, awayForm);

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

    processed++;
  }

  return NextResponse.json({ success: true, processed: processed });
}
`);

// ================================================================
// app/page.tsx - lista meciuri + search + selector zi
// ================================================================
writeFile('app/page.tsx', `'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase';

interface MatchListItem {
  id: string;
  home_team_name: string;
  away_team_name: string;
  kickoff_utc: string;
  league_id: number;
  topProbability: number | null;
  topLabel: string | null;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
}

function probabilityColor(prob: number): string {
  if (prob >= 0.9) return 'bg-emerald-500';
  if (prob >= 0.8) return 'bg-lime-500';
  if (prob >= 0.7) return 'bg-yellow-500';
  return 'bg-slate-500';
}

export default function HomePage() {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [searchTerm, setSearchTerm] = useState('');
  const [matches, setMatches] = useState<MatchListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadMatches() {
      setLoading(true);

      const startOfDay = selectedDate + 'T00:00:00';
      const endOfDay = selectedDate + 'T23:59:59';

      const { data: matchesData } = await supabaseBrowser
        .from('matches')
        .select('id, home_team_name, away_team_name, kickoff_utc, league_id')
        .gte('kickoff_utc', startOfDay)
        .lte('kickoff_utc', endOfDay)
        .order('kickoff_utc', { ascending: true });

      if (!matchesData) {
        setMatches([]);
        setLoading(false);
        return;
      }

      const enriched: MatchListItem[] = [];
      for (const m of matchesData) {
        const { data: topPrediction } = await supabaseBrowser
          .from('predictions')
          .select('label, probability')
          .eq('match_id', m.id)
          .order('probability', { ascending: false })
          .limit(1)
          .single();

        enriched.push({
          ...m,
          topProbability: topPrediction?.probability ?? null,
          topLabel: topPrediction?.label ?? null,
        });
      }

      setMatches(enriched);
      setLoading(false);
    }

    loadMatches();
  }, [selectedDate]);

  const filteredMatches = matches.filter((m) => {
    const term = searchTerm.toLowerCase();
    return (
      m.home_team_name.toLowerCase().includes(term) ||
      m.away_team_name.toLowerCase().includes(term)
    );
  });

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 px-4 py-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-semibold mb-6">Analiza meciuri</h1>

        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="Cauta o echipa..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm"
          />
        </div>

        {loading && <p className="text-slate-400 text-sm">Se incarca meciurile...</p>}

        {!loading && filteredMatches.length === 0 && (
          <p className="text-slate-400 text-sm">Nu exista meciuri pentru aceasta zi.</p>
        )}

        <div className="space-y-2">
          {filteredMatches.map((m) => (
            <Link
              key={m.id}
              href={'/match/' + m.id}
              className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-lg px-4 py-3 hover:border-slate-600 transition"
            >
              <div>
                <p className="text-sm font-medium">{m.home_team_name} - {m.away_team_name}</p>
                <p className="text-xs text-slate-500">{formatTime(m.kickoff_utc)}</p>
              </div>
              {m.topProbability !== null && (
                <div className="text-right">
                  <span className={'inline-block text-xs font-semibold text-white px-2 py-1 rounded ' + probabilityColor(m.topProbability)}>
                    {Math.round(m.topProbability * 100)}%
                  </span>
                  <p className="text-xs text-slate-400 mt-1">{m.topLabel}</p>
                </div>
              )}
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
`);

// ================================================================
// app/match/[id]/page.tsx - detaliu meci
// ================================================================
writeFile('app/match/[id]/page.tsx', `'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase';

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

function probabilityBadgeClass(prob: number): string {
  if (prob >= 0.9) return 'bg-emerald-500';
  if (prob >= 0.8) return 'bg-lime-500';
  if (prob >= 0.7) return 'bg-yellow-500';
  return 'bg-slate-600';
}

export default function MatchDetailPage() {
  const params = useParams();
  const matchId = params.id as string;

  const [match, setMatch] = useState<MatchDetail | null>(null);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [odds, setOdds] = useState<OddRow[]>([]);
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

      setMatch(matchData);
      setPredictions(predictionsData || []);
      setOdds(oddsData || []);
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
            <div className="space-y-1">
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
      </div>
    </main>
  );
}
`);

// ================================================================
// .env.local.example
// ================================================================
writeFile('.env.local.example', `API_FOOTBALL_KEY=cheia_ta_de_la_api-football.com
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=cheia_anon_publica_din_supabase
SUPABASE_SERVICE_ROLE_KEY=cheia_service_role_secreta_din_supabase
CRON_SECRET=un_string_random_lung_pentru_securizarea_endpointului_de_sync
`);

// ================================================================
// vercel.json - cron zilnic
// ================================================================
writeFile('vercel.json', `{
  "crons": [
    {
      "path": "/api/sync",
      "schedule": "0 6 * * *"
    }
  ]
}
`);

// ================================================================
// supabase/schema.sql
// ================================================================
writeFile('supabase/schema.sql', `-- Schema initiala pentru platforma de analiza meciuri.
-- Ruleaza acest script in Supabase: Project -> SQL Editor -> New query -> Run

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  api_football_id integer unique not null,
  name text not null,
  league_id integer not null,
  created_at timestamptz default now()
);

create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  api_football_id integer unique not null,
  league_id integer not null,
  home_team_name text not null,
  away_team_name text not null,
  kickoff_utc timestamptz not null,
  status text,
  created_at timestamptz default now()
);

create table if not exists predictions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references matches(id) on delete cascade,
  market text not null,
  selection text not null,
  label text not null,
  probability numeric not null,
  fair_odds numeric not null,
  created_at timestamptz default now()
);

create table if not exists odds (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references matches(id) on delete cascade,
  bookmaker text not null,
  market text not null,
  selection text not null,
  odd_value numeric not null,
  fetched_at timestamptz default now()
);

create index if not exists idx_matches_kickoff on matches(kickoff_utc);
create index if not exists idx_predictions_match on predictions(match_id);
create index if not exists idx_odds_match on odds(match_id);

-- Row Level Security: citire publica, scrierea se face doar din server
-- (cu service role key, care ocoleste automat RLS)
alter table matches enable row level security;
alter table predictions enable row level security;
alter table odds enable row level security;
alter table teams enable row level security;

create policy "Citire publica meciuri" on matches for select using (true);
create policy "Citire publica predictii" on predictions for select using (true);
create policy "Citire publica cote" on odds for select using (true);
create policy "Citire publica echipe" on teams for select using (true);
`);

console.log('\\nToate fisierele au fost generate cu succes.');
console.log('Urmeaza pasii afisati de setup.ps1 pentru configurare.');