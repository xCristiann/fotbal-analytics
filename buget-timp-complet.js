#!/usr/bin/env node
// Adauga buget de timp si la faza de LISTARE a ligilor (nu doar la
// analiza completa) - daca listarea insasi ia prea mult, ne oprim din
// a mai cere ligi noi si lucram cu ce am adunat pana atunci.

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
  `// Plasa de siguranta REALA: ne oprim din analiza completa dupa acest
// timp scurs (milisecunde), indiferent cate meciuri am facut. Lasam
// marja de 15s fata de limita de 60s a Vercel, pentru raspunsul final.
const SAFE_TIME_BUDGET_MS = Number(process.env.SAFE_TIME_BUDGET_MS || '45000');`,
  `// Plasa de siguranta REALA: ne oprim din analiza completa dupa acest
// timp scurs (milisecunde), indiferent cate meciuri am facut. Lasam
// marja de 15s fata de limita de 60s a Vercel, pentru raspunsul final.
const SAFE_TIME_BUDGET_MS = Number(process.env.SAFE_TIME_BUDGET_MS || '35000');

// Buget separat pentru faza de LISTARE (inainte de analiza completa).
// Daca listarea celor 18 ligi ia prea mult, ne oprim din a mai cere
// ligi noi si lucram cu ce am adunat pana atunci.
const LISTING_TIME_BUDGET_MS = Number(process.env.LISTING_TIME_BUDGET_MS || '20000');`
);

replaceInFile(
  'app/api/sync/route.ts',
  `  for (const leagueId of TRACKED_LEAGUES) {
    const result = await fetchSeasonFixtures(leagueId, season);`,
  `  for (const leagueId of TRACKED_LEAGUES) {
    if (Date.now() - startTime > LISTING_TIME_BUDGET_MS) {
      allApiErrors.push({ context: 'listare ligi', message: 'Oprit din listare dupa ' + LISTING_TIME_BUDGET_MS + 'ms - au ramas ligi neverificate in aceasta rulare.' });
      break;
    }
    const result = await fetchSeasonFixtures(leagueId, season);`
);

replaceInFile(
  'app/api/sync/route.ts',
  `  return NextResponse.json({
    success: true,
    season: season,
    maxFixturesFullAnalysis: MAX_FIXTURES_FULL_ANALYSIS,
    elapsedMs: Date.now() - startTime,
    stoppedByTimeBudget: (Date.now() - startTime) > SAFE_TIME_BUDGET_MS,
    processed: totalProcessed,`,
  `  return NextResponse.json({
    success: true,
    season: season,
    maxFixturesFullAnalysis: MAX_FIXTURES_FULL_ANALYSIS,
    listingTimeBudgetMs: LISTING_TIME_BUDGET_MS,
    safeTimeBudgetMs: SAFE_TIME_BUDGET_MS,
    elapsedMs: Date.now() - startTime,
    stoppedByTimeBudget: (Date.now() - startTime) > SAFE_TIME_BUDGET_MS,
    processed: totalProcessed,`
);

console.log('\\nGata! Acum ruleaza:');
console.log('  git add .');
console.log('  git commit -m "Adauga buget de timp si la listarea ligilor"');
console.log('  git push');
