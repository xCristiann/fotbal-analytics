#!/usr/bin/env node
// Adauga un esantion detaliat de predictii individuale in raspunsul
// backtest-ului - meci, ce am prezis, scorul real, corect/gresit -
// ca sa vedem cu ochii nostri unde se rupe firul, in loc sa ghicim.

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
  'app/api/backtest/route.ts',
  `  let matchesVerificate = 0;
  let matchesNeterminate = 0;
  let matchesFaraPredictii = 0;
  const apiErrors: any[] = [];`,
  `  let matchesVerificate = 0;
  let matchesNeterminate = 0;
  let matchesFaraPredictii = 0;
  const apiErrors: any[] = [];
  const sampleDetails: any[] = [];
  const SAMPLE_SIZE = 20;`
);

replaceInFile(
  'app/api/backtest/route.ts',
  `    for (const p of predictions) {
      const correct = checkPrediction(
        p.market, p.selection, homeGoals, awayGoals,
        homeCorners, awayCorners, homeCards, awayCards, homeShots, awayShots
      );
      if (correct === null) continue;

      const key = bucketKeyFor(p.probability);
      buckets[key].total++;
      if (correct) buckets[key].correct++;

      if (!perMarketBuckets[p.market]) perMarketBuckets[p.market] = { total: 0, correct: 0 };
      perMarketBuckets[p.market].total++;
      if (correct) perMarketBuckets[p.market].correct++;
    }`,
  `    for (const p of predictions) {
      const correct = checkPrediction(
        p.market, p.selection, homeGoals, awayGoals,
        homeCorners, awayCorners, homeCards, awayCards, homeShots, awayShots
      );
      if (correct === null) continue;

      const key = bucketKeyFor(p.probability);
      buckets[key].total++;
      if (correct) buckets[key].correct++;

      if (!perMarketBuckets[p.market]) perMarketBuckets[p.market] = { total: 0, correct: 0 };
      perMarketBuckets[p.market].total++;
      if (correct) perMarketBuckets[p.market].correct++;

      if (sampleDetails.length < SAMPLE_SIZE && (p.market === '1X2' || p.market === 'BTTS')) {
        sampleDetails.push({
          meci: match.home_team_name + ' - ' + match.away_team_name,
          scorReal: homeGoals + '-' + awayGoals,
          piata: p.market,
          selectiaNoastra: p.selection,
          etichetaNoastra: p.label,
          probabilitateaNoastra: Math.round(p.probability * 100) + '%',
          corect: correct,
        });
      }
    }`
);

replaceInFile(
  'app/api/backtest/route.ts',
  `    acurateteReala_pePiata: marketSummary,
    apiErrors: apiErrors,`,
  `    acurateteReala_pePiata: marketSummary,
    esantionDetaliat: sampleDetails,
    apiErrors: apiErrors,`
);

console.log('\\nGata! Acum ruleaza:');
console.log('  git add .');
console.log('  git commit -m "Adauga esantion detaliat de predictii in backtest, pentru diagnostic"');
console.log('  git push');
