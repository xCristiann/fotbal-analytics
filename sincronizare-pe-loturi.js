#!/usr/bin/env node
// Rezolva structural, nu cu ajustari de buget: impartim cele 18 ligi
// in loturi de 6, procesate separat (3 apeluri in loc de unul singur
// supraincarcat). Fiecare lot incape usor in timp. Cron-ul e setat sa
// ruleze toate cele 3 loturi automat, zilnic - dupa asta nu mai trebuie
// sa faci nimic manual pentru sincronizarea zilnica.

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

function writeFile(relativePath, content) {
  const fullPath = path.join(__dirname, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, { encoding: 'utf8' });
  console.log('Actualizat: ' + relativePath);
}

replaceInFile(
  'app/api/sync/route.ts',
  '  const requestUrl = new URL(request.url);\n  const testDate = requestUrl.searchParams.get(\'date\');',
  `  const requestUrl = new URL(request.url);
  const testDate = requestUrl.searchParams.get('date');
  const batchParam = requestUrl.searchParams.get('batch');
  const batchIndex = batchParam !== null ? parseInt(batchParam, 10) : null;

  // Daca vine cu ?batch=N, procesam DOAR acel lot de ligi (6 ligi per
  // lot). Fara ?batch, procesam toate ligile intr-un singur apel (util
  // pentru teste manuale pe zile cu putine meciuri, dar poate da
  // timeout daca sunt multe ligi/meciuri - de-aia exista modul pe loturi).
  const BATCH_SIZE = 6;
  const leaguesToProcess = batchIndex !== null
    ? TRACKED_LEAGUES.slice(batchIndex * BATCH_SIZE, (batchIndex + 1) * BATCH_SIZE)
    : TRACKED_LEAGUES;`
);

replaceInFile(
  'app/api/sync/route.ts',
  '  for (const leagueId of TRACKED_LEAGUES) {',
  '  for (const leagueId of leaguesToProcess) {'
);

replaceInFile(
  'app/api/sync/route.ts',
  `  return NextResponse.json({
    success: true,
    season: season,
    maxFixturesFullAnalysis: MAX_FIXTURES_FULL_ANALYSIS,
    listingTimeBudgetMs: LISTING_TIME_BUDGET_MS,`,
  `  return NextResponse.json({
    success: true,
    season: season,
    batch: batchIndex,
    leaguesProcessedThisBatch: leaguesToProcess,
    maxFixturesFullAnalysis: MAX_FIXTURES_FULL_ANALYSIS,
    listingTimeBudgetMs: LISTING_TIME_BUDGET_MS,`
);

writeFile('vercel.json', `{
  "crons": [
    {
      "path": "/api/sync?batch=0",
      "schedule": "0 6 * * *"
    },
    {
      "path": "/api/sync?batch=1",
      "schedule": "20 6 * * *"
    },
    {
      "path": "/api/sync?batch=2",
      "schedule": "40 6 * * *"
    }
  ]
}
`);

console.log('\\nGata! Acum ruleaza:');
console.log('  git add .');
console.log('  git commit -m "Sincronizare pe loturi de ligi, cron automat pentru toate"');
console.log('  git push');
