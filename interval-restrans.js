#!/usr/bin/env node
// In loc sa cerem TOT sezonul unei ligi (sute de meciuri) doar ca sa
// gasim saptamana curenta, cerem un interval restrans: ultimele 90 de
// zile (suficient pentru medii de goluri pe liga) + saptamana urmatoare
// (pentru meciurile pe care vrem sa le afisam). Mult mai rapid.

const fs = require('fs');
const path = require('path');

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
  'lib/apiFootball.ts',
  `export async function fetchSeasonFixtures(leagueId: number, season: number): Promise<FixturesResult> {
  const url = API_BASE + '/fixtures?league=' + leagueId + '&season=' + season;
  const { data, errors } = await apiCall(url);
  const fixtures = (data && data.response) ? data.response : [];
  return { fixtures: fixtures, errors: errors };
}`,
  `export async function fetchSeasonFixtures(leagueId: number, season: number, fromDate?: string, toDate?: string): Promise<FixturesResult> {
  let url = API_BASE + '/fixtures?league=' + leagueId + '&season=' + season;
  if (fromDate && toDate) {
    url += '&from=' + fromDate + '&to=' + toDate;
  }
  const { data, errors } = await apiCall(url);
  const fixtures = (data && data.response) ? data.response : [];
  return { fixtures: fixtures, errors: errors };
}`
);

replaceInFile(
  'app/api/sync/route.ts',
  `function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}`,
  `function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function subtractDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().split('T')[0];
}`
);

replaceInFile(
  'app/api/sync/route.ts',
  `  const fullAnalysisDates = new Set(testDate ? targetDates : targetDates.slice(0, DAYS_WITH_FULL_ANALYSIS));
  const season = inferSeason(referenceDateForSeason);`,
  `  const fullAnalysisDates = new Set(testDate ? targetDates : targetDates.slice(0, DAYS_WITH_FULL_ANALYSIS));
  const season = inferSeason(referenceDateForSeason);

  // Interval restrans pentru listare: ultimele 90 de zile (destule
  // meciuri terminate pentru medii de goluri pe liga) + fereastra
  // noastra de zile tinta, in loc de tot sezonul (mult mai rapid).
  const rangeFrom = subtractDays(referenceDateForSeason, 90);
  const rangeTo = targetDates[targetDates.length - 1];`
);

replaceInFile(
  'app/api/sync/route.ts',
  `    const result = await fetchSeasonFixtures(leagueId, season);`,
  `    const result = await fetchSeasonFixtures(leagueId, season, rangeFrom, rangeTo);`
);

console.log('\\nGata! Acum ruleaza:');
console.log('  git add .');
console.log('  git commit -m "Cerem interval restrans in loc de tot sezonul - mult mai rapid"');
console.log('  git push');
