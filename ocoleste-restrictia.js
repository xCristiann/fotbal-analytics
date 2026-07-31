#!/usr/bin/env node
// Ocolim restrictia (inconsistenta) a planului gratuit pe parametrul
// "date=". In loc sa cerem meciuri pe o data anume, luam lista COMPLETA
// de meciuri pe liga+sezon (1 singur call per liga) si filtram local
// dupa data. Bonus: mult mai eficient si la cereri API (9 calluri in
// loc de 63 pentru o saptamana intreaga).

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

// Ia TOATE meciurile unei ligi pe un sezon intreg (1 singur apel API).
// Filtrarea pe data se face local, ca sa evitam restrictiile ciudate
// ale planului gratuit pe parametrul "date=".
export async function fetchSeasonFixtures(leagueId: number, season: number): Promise<FixturesResult> {
  const url = API_BASE + '/fixtures?league=' + leagueId + '&season=' + season;
  const res = await fetch(url, { headers: getHeaders() });
  const data = await res.json();

  const fixtures = (data && data.response) ? data.response : [];
  const errors: any[] = [];
  const hasErrors = data && data.errors && (
    Array.isArray(data.errors) ? data.errors.length > 0 : Object.keys(data.errors).length > 0
  );
  if (hasErrors) {
    errors.push({ leagueId: leagueId, season: season, httpStatus: res.status, apiErrors: data.errors, results: data.results });
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
import { fetchSeasonFixtures, fetchTeamStatistics, fetchOddsByFixture, inferSeason } from '@/lib/apiFootball';
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
  // data (cu analiza completa), util pentru testare pe date istorice.
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

      const homeStats = await fetchTeamStatistics(homeTeam.id, fixtureLeagueId, fixtureSeason);
      const awayStats = await fetchTeamStatistics(awayTeam.id, fixtureLeagueId, fixtureSeason);

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
    days: summary,
    apiErrors: allApiErrors.slice(0, 10),
  });
}
`);

console.log('\\nGata! Acum ruleaza:');
console.log('  git add .');
console.log('  git commit -m "Ocoleste restrictia planului gratuit pe parametrul date"');
console.log('  git push');
