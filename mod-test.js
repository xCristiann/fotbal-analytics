#!/usr/bin/env node
// Adauga un mod de testare: poti cere sincronizare pentru o data
// specifica (utila pentru sezoane istorice, permise pe planul gratuit).
// Repara si calculul sezonului, care era gresit pentru date din prima
// jumatate a anului (sezonul european incepe in iulie/august, nu in ianuarie).

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

function getHeaders() {
  return {
    'x-apisports-key': process.env.API_FOOTBALL_KEY || '',
  };
}

// Sezonul european se numeste dupa anul in care INCEPE (ex: sezonul
// 2025/2026 se numeste "2025" in API). Regula: daca luna e iulie sau
// mai tarziu, sezonul e anul curent; altfel e anul anterior.
function inferSeason(dateStr: string): number {
  const d = new Date(dateStr);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  return month >= 7 ? year : year - 1;
}

export interface FixturesResult {
  fixtures: any[];
  errors: any[];
}

export async function fetchFixturesByDate(date: string, leagueIds: number[]): Promise<FixturesResult> {
  const fixtures: any[] = [];
  const errors: any[] = [];
  const season = inferSeason(date);

  for (const leagueId of leagueIds) {
    const url = API_BASE + '/fixtures?date=' + date + '&league=' + leagueId + '&season=' + season;
    const res = await fetch(url, { headers: getHeaders() });
    const data = await res.json();

    if (data && data.response) {
      fixtures.push(...data.response);
    }

    const hasErrors = data && data.errors && (
      Array.isArray(data.errors) ? data.errors.length > 0 : Object.keys(data.errors).length > 0
    );
    if (hasErrors) {
      errors.push({ leagueId: leagueId, date: date, season: season, httpStatus: res.status, apiErrors: data.errors, results: data.results });
    }
  }

  return { fixtures: fixtures, errors: errors };
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

writeFile('app/api/sync/route.ts', `import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { fetchFixturesByDate, fetchTeamStatistics, fetchOddsByFixture } from '@/lib/apiFootball';
import { calculateAllMarkets, TeamForm } from '@/lib/poisson';

const TRACKED_LEAGUES = [283, 39, 140, 135, 78, 61, 2, 3, 848];
const DAYS_AHEAD = 7;
const DAYS_WITH_FULL_ANALYSIS = 3;

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

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

  // Mod de testare: /api/sync?date=2023-04-15 sincronizeaza DOAR acea
  // data (cu analiza completa), util pentru testare pe date istorice
  // permise de planul gratuit, inainte de a trece pe plan platit.
  const url = new URL(request.url);
  const testDate = url.searchParams.get('date');

  const datesToProcess: { dateStr: string; doFullAnalysis: boolean }[] = [];

  if (testDate) {
    datesToProcess.push({ dateStr: testDate, doFullAnalysis: true });
  } else {
    for (let dayOffset = 0; dayOffset < DAYS_AHEAD; dayOffset++) {
      const targetDate = new Date();
      targetDate.setUTCDate(targetDate.getUTCDate() + dayOffset);
      datesToProcess.push({ dateStr: formatDate(targetDate), doFullAnalysis: dayOffset < DAYS_WITH_FULL_ANALYSIS });
    }
  }

  let totalProcessed = 0;
  let totalWithAnalysis = 0;
  const summary: any[] = [];
  const allApiErrors: any[] = [];

  for (const dateEntry of datesToProcess) {
    const dateStr = dateEntry.dateStr;
    const doFullAnalysis = dateEntry.doFullAnalysis;

    const result = await fetchFixturesByDate(dateStr, TRACKED_LEAGUES);
    const fixtures = result.fixtures;
    if (result.errors.length > 0) {
      allApiErrors.push(...result.errors);
    }
    let dayCount = 0;

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

      dayCount++;
      totalProcessed++;

      if (!doFullAnalysis) continue;

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

      totalWithAnalysis++;
    }

    summary.push({ date: dateStr, matches: dayCount, fullAnalysis: doFullAnalysis });
  }

  return NextResponse.json({
    success: true,
    processed: totalProcessed,
    withAnalysis: totalWithAnalysis,
    days: summary,
    apiErrors: allApiErrors.slice(0, 10),
  });
}
`);

console.log('\\nGata! Acum ruleaza:');
console.log('  git add .');
console.log('  git commit -m "Adauga mod de testare pe date istorice + repara calculul sezonului"');
console.log('  git push');
