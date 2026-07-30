import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
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
