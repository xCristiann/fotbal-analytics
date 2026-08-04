#!/usr/bin/env node
// Adauga parametrul ?force=true, care ignora verificarea "deja
// analizat" - util ori de cate ori imbunatatim algoritmul si vrem sa
// refacem meciuri analizate anterior cu varianta veche.

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
  "  const batchParam = requestUrl.searchParams.get('batch');",
  "  const batchParam = requestUrl.searchParams.get('batch');\n  const forceReanalysis = requestUrl.searchParams.get('force') === 'true';"
);

replaceInFile(
  'app/api/sync/route.ts',
  `  const candidatesNeedingAnalysis = eligibleForAnalysis.filter((c) => !alreadyAnalyzedIds.has(c.matchRow.id));`,
  `  const candidatesNeedingAnalysis = forceReanalysis
    ? eligibleForAnalysis
    : eligibleForAnalysis.filter((c) => !alreadyAnalyzedIds.has(c.matchRow.id));`
);

console.log('\\nGata! Acum ruleaza:');
console.log('  git add .');
console.log('  git commit -m "Adauga parametrul force pentru re-analiza meciurilor deja facute"');
console.log('  git push');
