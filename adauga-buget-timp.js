#!/usr/bin/env node
// Adauga o plasa de siguranta bazata pe TIMP REAL de executie, nu doar
// pe numarul de meciuri. Indiferent cate ligi sau ce viteza avem,
// functia se opreste singura din analiza completa cu marja de
// siguranta inainte de limita de 60s a Vercel, listand restul
// meciurilor fara analiza (completate la rularea urmatoare).
// Scade si viteza implicita, acum ca planul e platit.

const fs = require('fs');
const path = require('path');

function readFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
}

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

// Scade viteza implicita (planul platit permite mult mai mult pe minut)
replaceInFile(
  'lib/apiFootball.ts',
  "const REQUEST_DELAY_MS = Number(process.env.API_REQUEST_DELAY_MS || '700');",
  "const REQUEST_DELAY_MS = Number(process.env.API_REQUEST_DELAY_MS || '200');"
);

// Adauga bugetul de timp real
replaceInFile(
  'app/api/sync/route.ts',
  "const MAX_FIXTURES_FULL_ANALYSIS = Number(process.env.MAX_FIXTURES_FULL_ANALYSIS || '4');",
  `const MAX_FIXTURES_FULL_ANALYSIS = Number(process.env.MAX_FIXTURES_FULL_ANALYSIS || '10');

// Plasa de siguranta REALA: ne oprim din analiza completa dupa acest
// timp scurs (milisecunde), indiferent cate meciuri am facut. Lasam
// marja de 15s fata de limita de 60s a Vercel, pentru raspunsul final.
const SAFE_TIME_BUDGET_MS = Number(process.env.SAFE_TIME_BUDGET_MS || '45000');`
);

replaceInFile(
  'app/api/sync/route.ts',
  '  const requestUrl = new URL(request.url);',
  '  const startTime = Date.now();\n  const requestUrl = new URL(request.url);'
);

replaceInFile(
  'app/api/sync/route.ts',
  `      if (!fullAnalysisDates.has(fixtureDateStr)) continue;
      if (fullAnalysisBudgetUsed >= MAX_FIXTURES_FULL_ANALYSIS) continue;

      fullAnalysisBudgetUsed++;`,
  `      if (!fullAnalysisDates.has(fixtureDateStr)) continue;
      if (fullAnalysisBudgetUsed >= MAX_FIXTURES_FULL_ANALYSIS) continue;
      if (Date.now() - startTime > SAFE_TIME_BUDGET_MS) continue;

      fullAnalysisBudgetUsed++;`
);

replaceInFile(
  'app/api/sync/route.ts',
  `  return NextResponse.json({
    success: true,
    season: season,
    maxFixturesFullAnalysis: MAX_FIXTURES_FULL_ANALYSIS,
    processed: totalProcessed,`,
  `  return NextResponse.json({
    success: true,
    season: season,
    maxFixturesFullAnalysis: MAX_FIXTURES_FULL_ANALYSIS,
    elapsedMs: Date.now() - startTime,
    stoppedByTimeBudget: (Date.now() - startTime) > SAFE_TIME_BUDGET_MS,
    processed: totalProcessed,`
);

console.log('\\nGata! Acum ruleaza:');
console.log('  git add .');
console.log('  git commit -m "Adauga buget de timp real, previne definitiv timeout-ul"');
console.log('  git push');
