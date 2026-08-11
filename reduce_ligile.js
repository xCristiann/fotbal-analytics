#!/usr/bin/env node
// Reduce la exact 9 ligi: Anglia, Spania, Franta, Italia, Germania,
// Romania, Champions League, Europa League, Conference League.
// Redistribuie cele 3 cupe europene in loturi diferite (nu adunate),
// si simplifica cron-ul la 3 rulari/zi in loc de 6.

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
  `// Ordinea conteaza: ligile cu acoperire de date SIGURA (statistici
// complete - cornere, suturi, cartonase) primele, ca bugetul de
// analiza sa fie folosit intai acolo. Cele 3 cupe europene (grele ca
// volum in perioada de calificari) sunt distribuite in loturi
// diferite, nu adunate impreuna.
// Lot 0: Premier League, La Liga, Serie A (cea mai buna acoperire)
// Lot 1: Bundesliga, Ligue 1, Liga 1 Romania
// Lot 2: Champions League, Eredivisie, Portugalia
// Lot 3: Europa League, Belgia, Turcia
// Lot 4: Conference League, Brazilia, MLS
// Lot 5: Liga MX, Championship (Anglia), Scotia
const TRACKED_LEAGUES = [39, 140, 135, 78, 61, 283, 2, 88, 94, 3, 144, 203, 848, 71, 253, 262, 40, 179];`,
  `// Doar 9 ligi, exact cele cerute. Cele 3 cupe europene (grele ca
// volum in perioada de calificari) sunt distribuite in loturi
// diferite, cate una per lot, nu adunate impreuna.
// Lot 0: Premier League, La Liga, Champions League
// Lot 1: Bundesliga, Ligue 1, Europa League
// Lot 2: Serie A, Liga 1 Romania, Conference League
const TRACKED_LEAGUES = [39, 140, 2, 78, 61, 3, 135, 283, 848];`
);

writeFile('vercel.json', `{
  "crons": [
    { "path": "/api/sync?batch=0", "schedule": "0 6 * * *" },
    { "path": "/api/sync?batch=1", "schedule": "20 6 * * *" },
    { "path": "/api/sync?batch=2", "schedule": "40 6 * * *" }
  ]
}
`);

console.log('\\nGata! Acum ruleaza:');
console.log('  git add .');
console.log('  git commit -m "Reduce la 9 ligi (Anglia, Spania, Franta, Italia, Germania, Romania + 3 cupe europene)"');
console.log('  git push');
