#!/usr/bin/env node
// Doua corectii bazate pe date reale de backtest:
// 1. Reduce ponderea H2H la BTTS/Peste-Sub 2.5 (25% -> 15%, prag minim
//    3 -> 5 meciuri) - dovezile arata ca la esantioane mici, H2H
//    adauga zgomot, nu semnal, la aceste doua piete specific.
// 2. Aplica o corectie de "umilinta" (shrinkage) pe piete derivate din
//    modelul de goluri (1X2, BTTS, Peste/Sub 2.5, Combo) - trage
//    probabilitatile usor spre mijloc, ca sa corecteze supra-increderea
//    observata la toate pragurile (90-100% functiona real la doar 69%).
// Cornere/Cartonase/Suturi RAMAN NESCHIMBATE - functioneaza deja bine,
// nu au nevoie de corectie.

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
  'lib/poisson.ts',
  `  if (h2h && h2h.matchesCount >= 3) {
    const h2hWeight = 0.25;
    pBttsYes = pBttsYes * (1 - h2hWeight) + h2h.bttsRate * h2hWeight;
    pOver25 = pOver25 * (1 - h2hWeight) + h2h.over25Rate * h2hWeight;
  }`,
  `  // Redus de la 25% la 15%, si pragul minim de la 3 la 5 meciuri -
  // backtest-ul a aratat ca la esantioane mici, H2H adauga zgomot,
  // nu semnal real, la aceste doua piete.
  if (h2h && h2h.matchesCount >= 5) {
    const h2hWeight = 0.15;
    pBttsYes = pBttsYes * (1 - h2hWeight) + h2h.bttsRate * h2hWeight;
    pOver25 = pOver25 * (1 - h2hWeight) + h2h.over25Rate * h2hWeight;
  }`
);

replaceInFile(
  'lib/poisson.ts',
  `  const pBttsNo = 1 - pBttsYes;
  const pUnder25Final = 1 - pOver25;
  const pDoubleChance12 = pHomeWin + pAwayWin;`,
  `  // Corectie de supra-incredere (shrinkage): backtest-ul arata ca
  // predictiile noastre de goluri sunt sistematic prea sigure fata de
  // realitate (90-100% incredere functiona doar la 69% in realitate).
  // Tragem usor probabilitatile spre centrul lor teoretic, pastrand
  // ordinea relativa (predictiile puternice raman cele mai puternice).
  const SHRINK = 0.8;
  function shrinkTernary(p: number, mean: number): number {
    return mean + (p - mean) * SHRINK;
  }

  const shrunkHomeWin = shrinkTernary(pHomeWin, 1 / 3);
  const shrunkDraw = shrinkTernary(pDraw, 1 / 3);
  const shrunkAwayWin = shrinkTernary(pAwayWin, 1 / 3);
  pHomeWin = shrunkHomeWin;
  pDraw = shrunkDraw;
  pAwayWin = shrunkAwayWin;

  const shrunkBttsYes = 0.5 + (pBttsYes - 0.5) * SHRINK;
  pBttsYes = shrunkBttsYes;
  const shrunkOver25 = 0.5 + (pOver25 - 0.5) * SHRINK;
  pOver25 = shrunkOver25;

  const pBttsNo = 1 - pBttsYes;
  const pUnder25Final = 1 - pOver25;
  const pDoubleChance12 = pHomeWin + pAwayWin;`
);

replaceInFile(
  'lib/poisson.ts',
  `    { market: 'COMBO', selection: 'GG_PESTE25', label: 'GG si Peste 2.5', probability: pBttsYesOver25, fairOdds: 1 / pBttsYesOver25 },
    { market: 'COMBO', selection: 'GG_SUB25', label: 'GG si Sub 2.5', probability: pBttsYesUnder25, fairOdds: 1 / pBttsYesUnder25 },
    { market: 'COMBO', selection: 'NG_PESTE25', label: 'NG si Peste 2.5', probability: pBttsNoOver25, fairOdds: 1 / pBttsNoOver25 },
    { market: 'COMBO', selection: 'NG_SUB25', label: 'NG si Sub 2.5', probability: pBttsNoUnder25, fairOdds: 1 / pBttsNoUnder25 },`,
  `    { market: 'COMBO', selection: 'GG_PESTE25', label: 'GG si Peste 2.5', probability: shrinkTernary(pBttsYesOver25, 0.25), fairOdds: 1 / shrinkTernary(pBttsYesOver25, 0.25) },
    { market: 'COMBO', selection: 'GG_SUB25', label: 'GG si Sub 2.5', probability: shrinkTernary(pBttsYesUnder25, 0.25), fairOdds: 1 / shrinkTernary(pBttsYesUnder25, 0.25) },
    { market: 'COMBO', selection: 'NG_PESTE25', label: 'NG si Peste 2.5', probability: shrinkTernary(pBttsNoOver25, 0.25), fairOdds: 1 / shrinkTernary(pBttsNoOver25, 0.25) },
    { market: 'COMBO', selection: 'NG_SUB25', label: 'NG si Sub 2.5', probability: shrinkTernary(pBttsNoUnder25, 0.25), fairOdds: 1 / shrinkTernary(pBttsNoUnder25, 0.25) },`
);

console.log('\\nGata! Acum ruleaza:');
console.log('  node calibreaza_modelul.js');
console.log('  git add .');
console.log('  git commit -m "Calibrare bazata pe backtest: reduce H2H la BTTS/OU25, corecteaza supra-increderea"');
console.log('  git push');
