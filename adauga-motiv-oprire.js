#!/usr/bin/env node
// Adauga in raspuns motivul EXACT pentru care Faza 2 (analiza) s-a
// oprit: buget de meciuri epuizat, timp epuizat, sau pur si simplu
// a terminat toate meciurile eligibile.

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
  `  // ================== FAZA 2: ANALIZA COMPLETA (limitata de timp/buget) ==================
  for (const candidate of candidatesNeedingAnalysis) {
    if (fullAnalysisBudgetUsed >= MAX_FIXTURES_FULL_ANALYSIS) break;
    if (Date.now() - startTime > SAFE_TIME_BUDGET_MS) break;`,
  `  // ================== FAZA 2: ANALIZA COMPLETA (limitata de timp/buget) ==================
  let phase2StopReason = 'a procesat tot ce era eligibil';
  for (const candidate of candidatesNeedingAnalysis) {
    if (fullAnalysisBudgetUsed >= MAX_FIXTURES_FULL_ANALYSIS) {
      phase2StopReason = 'buget de meciuri epuizat (MAX_FIXTURES_FULL_ANALYSIS=' + MAX_FIXTURES_FULL_ANALYSIS + ')';
      break;
    }
    if (Date.now() - startTime > SAFE_TIME_BUDGET_MS) {
      phase2StopReason = 'timp epuizat (SAFE_TIME_BUDGET_MS=' + SAFE_TIME_BUDGET_MS + 'ms, scurs=' + (Date.now() - startTime) + 'ms)';
      break;
    }`
);

replaceInFile(
  'app/api/sync/route.ts',
  `    candidatesRemainingAfterThisRun: candidatesNeedingAnalysis.length - fullAnalysisBudgetUsed,`,
  `    candidatesRemainingAfterThisRun: candidatesNeedingAnalysis.length - fullAnalysisBudgetUsed,
    phase2StopReason: phase2StopReason,`
);

console.log('\\nGata! Acum ruleaza:');
console.log('  git add .');
console.log('  git commit -m "Adauga motivul exact de oprire al fazei de analiza"');
console.log('  git push');
