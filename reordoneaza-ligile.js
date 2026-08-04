#!/usr/bin/env node
// 1. Rearanjeaza ligile: cele cu acoperire de date sigura (top 5
//    Europa + Liga 1 Romania) primele, ca bugetul de analiza sa mearga
//    intai spre ele.
// 2. Distribuie cele 3 cupe europene grele (Champions/Europa/Conference
//    League) in loturi DIFERITE, nu adunate la un loc (cauza reala a
//    timeout-ului constant la un anumit lot).

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
  'const TRACKED_LEAGUES = [283, 39, 140, 135, 78, 61, 2, 3, 848, 88, 94, 144, 203, 71, 253, 262, 40, 179];',
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
const TRACKED_LEAGUES = [39, 140, 135, 78, 61, 283, 2, 88, 94, 3, 144, 203, 848, 71, 253, 262, 40, 179];`
);

console.log('\\nGata! Acum ruleaza:');
console.log('  git add .');
console.log('  git commit -m "Reordoneaza ligile: acoperire sigura primele, cupe europene distribuite"');
console.log('  git push');
