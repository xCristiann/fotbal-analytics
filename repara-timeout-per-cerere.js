#!/usr/bin/env node
// FIX FINAL: fiecare cerere individuala catre API-Football primeste un
// termen limita strict (10s). Daca API-Football nu raspunde la timp,
// cererea aia specifica e anulata si continuam - nu mai poate bloca
// TOT procesul o singura cerere agatata. Plus bugete de timp mai
// conservatoare, cu marja mai mare fata de limita de 60s a Vercel.

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
const REQUEST_DELAY_MS = Number(process.env.API_REQUEST_DELAY_MS || '200');

// Termen limita strict per cerere individuala. Daca API-Football nu
// raspunde in acest timp, anulam cererea si continuam - o singura
// cerere agatata nu mai poate bloca tot procesul.
const REQUEST_TIMEOUT_MS = Number(process.env.API_REQUEST_TIMEOUT_MS || '10000');

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
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, { headers: getHeaders(), signal: controller.signal });
    clearTimeout(timeoutHandle);
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
  } catch (err: any) {
    clearTimeout(timeoutHandle);
    const isTimeout = err && err.name === 'AbortError';
    const message = isTimeout
      ? 'Cerere anulata dupa ' + REQUEST_TIMEOUT_MS + 'ms - API-Football nu a raspuns la timp.'
      : (err && err.message ? err.message : String(err));
    return {
      data: {},
      status: 0,
      errors: [{ url: url, httpStatus: 0, apiErrors: { timeout: message } }],
    };
  }
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

export async function fetchSeasonFixtures(leagueId: number, season: number, fromDate?: string, toDate?: string): Promise<FixturesResult> {
  let url = API_BASE + '/fixtures?league=' + leagueId + '&season=' + season;
  if (fromDate && toDate) {
    url += '&from=' + fromDate + '&to=' + toDate;
  }
  const { data, errors } = await apiCall(url);
  const fixtures = (data && data.response) ? data.response : [];
  return { fixtures: fixtures, errors: errors };
}

export async function fetchTeamStatistics(teamId: number, leagueId: number, season: number) {
  const url = API_BASE + '/teams/statistics?team=' + teamId + '&league=' + leagueId + '&season=' + season;
  const { data } = await apiCall(url);
  return data ? data.response : undefined;
}

export async function fetchOddsByFixture(fixtureId: number) {
  const url = API_BASE + '/odds?fixture=' + fixtureId;
  const { data } = await apiCall(url);
  return data ? data.response : undefined;
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

function replaceInFile(relativePath, oldStr, newStr) {
  const fullPath = path.join(__dirname, relativePath);
  let content = fs.readFileSync(fullPath, 'utf8');
  if (!content.includes(oldStr)) {
    console.log('EROARE: nu am gasit textul de inlocuit in ' + relativePath);
    process.exit(1);
  }
  content = content.split(oldStr).join(newStr);
  fs.writeFileSync(fullPath, content, { encoding: 'utf8' });
  console.log('Actualizat: ' + relativePath);
}

replaceInFile(
  'app/api/sync/route.ts',
  "const MAX_FIXTURES_FULL_ANALYSIS = Number(process.env.MAX_FIXTURES_FULL_ANALYSIS || '10');\nconst SAFE_TIME_BUDGET_MS = Number(process.env.SAFE_TIME_BUDGET_MS || '45000');\nconst LISTING_TIME_BUDGET_MS = Number(process.env.LISTING_TIME_BUDGET_MS || '20000');",
  "const MAX_FIXTURES_FULL_ANALYSIS = Number(process.env.MAX_FIXTURES_FULL_ANALYSIS || '8');\nconst SAFE_TIME_BUDGET_MS = Number(process.env.SAFE_TIME_BUDGET_MS || '38000');\nconst LISTING_TIME_BUDGET_MS = Number(process.env.LISTING_TIME_BUDGET_MS || '15000');"
);

console.log('\\nGata! Acum ruleaza:');
console.log('  git add .');
console.log('  git commit -m "Adauga timeout per cerere individuala, previne blocarea completa"');
console.log('  git push');
