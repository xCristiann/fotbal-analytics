// Client minimal pentru API-Football (api-sports.io / api-football.com)
// Documentatie: https://www.api-football.com/documentation-v3

const API_BASE = 'https://v3.football.api-sports.io';

function getHeaders() {
  return {
    'x-apisports-key': process.env.API_FOOTBALL_KEY || '',
  };
}

export interface FixturesResult {
  fixtures: any[];
  errors: any[];
}

export async function fetchFixturesByDate(date: string, leagueIds: number[]): Promise<FixturesResult> {
  const fixtures: any[] = [];
  const errors: any[] = [];
  const season = new Date(date).getFullYear();

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
      errors.push({ leagueId: leagueId, date: date, httpStatus: res.status, apiErrors: data.errors, results: data.results });
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
