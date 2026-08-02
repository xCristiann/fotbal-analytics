// Client minimal pentru API-Football (api-sports.io / api-football.com)
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
