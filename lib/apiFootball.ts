// Client minimal pentru API-Football (api-sports.io / api-football.com)
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
