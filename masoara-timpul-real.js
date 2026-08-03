#!/usr/bin/env node
// Masoara EXACT cat dureaza fiecare liga, individual, in milisecunde.
// Fara asta ghicim; cu asta vedem precis unde se duce timpul.

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
  'app/api/sync/route.ts',
  '  const matchesPerDate: Record<string, number> = {};',
  '  const leagueTimings: any[] = [];\n  const matchesPerDate: Record<string, number> = {};'
);

replaceInFile(
  'app/api/sync/route.ts',
  `  for (const leagueId of leaguesToProcess) {
    if (Date.now() - startTime > LISTING_TIME_BUDGET_MS) {
      allApiErrors.push({ context: 'listare ligi', message: 'Oprit din listare dupa ' + LISTING_TIME_BUDGET_MS + 'ms - au ramas ligi neverificate in aceasta rulare.' });
      break;
    }
    const result = await fetchSeasonFixtures(leagueId, season, rangeFrom, rangeTo);`,
  `  for (const leagueId of leaguesToProcess) {
    if (Date.now() - startTime > LISTING_TIME_BUDGET_MS) {
      allApiErrors.push({ context: 'listare ligi', message: 'Oprit din listare dupa ' + LISTING_TIME_BUDGET_MS + 'ms - au ramas ligi neverificate in aceasta rulare.' });
      break;
    }
    const leagueCallStart = Date.now();
    const result = await fetchSeasonFixtures(leagueId, season, rangeFrom, rangeTo);
    leagueTimings.push({ leagueId: leagueId, ms: Date.now() - leagueCallStart, fixturesGasite: result.fixtures.length });`
);

replaceInFile(
  'app/api/sync/route.ts',
  `    batch: batchIndex,
    leaguesProcessedThisBatch: leaguesToProcess,`,
  `    batch: batchIndex,
    leaguesProcessedThisBatch: leaguesToProcess,
    leagueTimings: leagueTimings,`
);

console.log('\\nGata! Acum ruleaza:');
console.log('  git add .');
console.log('  git commit -m "Adauga masuratori exacte de timp per liga"');
console.log('  git push');
