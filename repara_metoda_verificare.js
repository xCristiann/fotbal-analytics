#!/usr/bin/env node
// Repara metoda de verificare: in loc sa verificam TOATE variantele
// stocate (ceea ce forteaza matematic 50%/33%/25% indiferent de
// calitatea modelului), verificam doar RECOMANDAREA reala - varianta
// cu probabilitatea mai mare, per piata, per meci. Asta da o masura
// corecta a calibrarii.

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
  `function bucketKeyFor(probability: number): string {`,
  `// Grupeaza predictiile complementare (DA/NU, Peste/Sub la acelasi
// prag) sub aceeasi cheie, ca sa pastram doar recomandarea reala -
// varianta cu probabilitatea mai mare - nu ambele parti.
function getGroupKey(market: string, selection: string): string {
  if (market === '1X2' || market === 'BTTS' || market === 'OU25' || market === 'COMBO') {
    return market;
  }
  if (market === 'CORNERS' || market === 'CARDS' || market === 'SHOTS') {
    if (selection.indexOf('BOTH_') === 0) {
      return market + '_' + selection;
    }
    const withoutDirection = selection.replace('_OVER_', '_').replace('_UNDER_', '_');
    return market + '_' + withoutDirection;
  }
  return market + '_' + selection;
}

function bucketKeyFor(probability: number): string {`
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
    }`,
  `    // Pastram DOAR recomandarea reala (probabilitatea mai mare) per
    // grup (piata + prag), nu toate variantele stocate.
    const topPerGroup = new Map<string, any>();
    for (const p of predictions) {
      const groupKey = getGroupKey(p.market, p.selection);
      const existing = topPerGroup.get(groupKey);
      if (!existing || p.probability > existing.probability) {
        topPerGroup.set(groupKey, p);
      }
    }

    for (const p of topPerGroup.values()) {
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

      if (sampleDetails.length < SAMPLE_SIZE && p.market !== '1X2') {
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

console.log('\nGata! Acum ruleaza:');
console.log('  git add .');
console.log('  git commit -m "Repara metoda de backtest: verifica doar recomandarea reala, nu toate variantele"');
console.log('  git push');
