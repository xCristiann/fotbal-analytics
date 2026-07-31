// Client minimal pentru API-Football (api-sports.io / api-football.com)
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
