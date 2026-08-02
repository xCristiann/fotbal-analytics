#!/usr/bin/env node
// 1. Trece Gemini pe alias auto-actualizat (gemini-flash-latest), ca
//    sa nu mai pice la fiecare retragere de model facuta de Google.
// 2. Extinde lista de ligi urmarite, acum ca planul platit permite mai
//    multe cereri fara restrictii.

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

replaceInFile(
  'lib/aiAnalysis.ts',
  "const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey;",
  "const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=' + apiKey;"
);

replaceInFile(
  'app/api/sync/route.ts',
  "const TRACKED_LEAGUES = [283, 39, 140, 135, 78, 61, 2, 3, 848];",
  `// Liga 1 Romania, top 5 european, cupe europene, plus ligi
// suplimentare - posibil acum datorita planului platit.
// 283 Liga 1 Romania, 39 Premier League, 140 La Liga, 135 Serie A,
// 78 Bundesliga, 61 Ligue 1, 2 Champions League, 3 Europa League,
// 848 Conference League, 88 Eredivisie, 94 Primeira Liga (Portugalia),
// 144 Jupiler Pro League (Belgia), 203 Super Lig (Turcia),
// 71 Brasileirao (Brazilia), 253 MLS (SUA), 262 Liga MX (Mexic),
// 40 Championship (Anglia, liga 2), 179 Scottish Premiership
const TRACKED_LEAGUES = [283, 39, 140, 135, 78, 61, 2, 3, 848, 88, 94, 144, 203, 71, 253, 262, 40, 179];`
);

console.log('\\nGata! Acum ruleaza:');
console.log('  git add .');
console.log('  git commit -m "Repara model Gemini deprecat, extinde ligile urmarite"');
console.log('  git push');
