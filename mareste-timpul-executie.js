#!/usr/bin/env node
// Limita reala nu vine de la API-Football (7500 cereri/zi e mult),
// vine de la Vercel: 60 secunde per apel, in mod implicit. Cu Fluid
// Compute activat (gratuit, chiar si pe Hobby), limita urca la 300
// secunde (5 minute) - de 5 ori mai mult spatiu pentru analiza completa.

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
  `export const maxDuration = 60;`,
  `// Necesita Fluid Compute activat in Vercel (Settings -> Functions).
// Fara Fluid Compute, Vercel oricum taie la 60s indiferent ce scriem
// aici - Fluid Compute e conditia reala, nu doar aceasta valoare.
export const maxDuration = 300;`
);

replaceInFile(
  'app/api/sync/route.ts',
  `const MAX_FIXTURES_FULL_ANALYSIS = Number(process.env.MAX_FIXTURES_FULL_ANALYSIS || '8');
const SAFE_TIME_BUDGET_MS = Number(process.env.SAFE_TIME_BUDGET_MS || '38000');
const LISTING_TIME_BUDGET_MS = Number(process.env.LISTING_TIME_BUDGET_MS || '15000');`,
  `const MAX_FIXTURES_FULL_ANALYSIS = Number(process.env.MAX_FIXTURES_FULL_ANALYSIS || '60');
const SAFE_TIME_BUDGET_MS = Number(process.env.SAFE_TIME_BUDGET_MS || '260000');
const LISTING_TIME_BUDGET_MS = Number(process.env.LISTING_TIME_BUDGET_MS || '60000');`
);

console.log('\\nGata! Acum ruleaza:');
console.log('  git add .');
console.log('  git commit -m "Creste limita de executie la 300s (necesita Fluid Compute in Vercel)"');
console.log('  git push');
