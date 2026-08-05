#!/usr/bin/env node
// Adauga un comutator (variabila de mediu) care dezactiveaza apelul
// catre Gemini complet - fara cod nou de aici incolo, doar din Vercel.
// Bonus: elimina si timpul pierdut pe cereri Gemini care oricum
// esueaza din cauza cotei, deci mai mult buget de timp ramas pentru
// analiza reala.

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
  `      const aiResult = await generateAIAnalysis({
        homeTeam: homeTeam.name,
        awayTeam: awayTeam.name,
        topMarkets: allMarkets.slice(0, 3).map((m) => ({ label: m.label, probability: m.probability })),
        homeForm: homeRecentForm,
        awayForm: awayRecentForm,
        h2hMatches: h2hList,
        homeAvgCorners: homeAvgCorners,
        awayAvgCorners: awayAvgCorners,
        homeAvgCards: homeAvgCards,
        awayAvgCards: awayAvgCards,
        homeInjuriesCount: homeInjuries.length,
        awayInjuriesCount: awayInjuries.length,
      });
      if (aiResult.error) {
        allApiErrors.push({ context: 'analiza AI (Gemini)', match: homeTeam.name + ' - ' + awayTeam.name, message: aiResult.error });
      }`,
  `      // Comutator: seteaza DISABLE_AI_ANALYSIS=true in Vercel Environment
      // Variables ca sa oprești analiza AI, fara sa mai fie nevoie de cod
      // nou. Sterge variabila (sau pune false) ca sa o repornesti.
      const aiDisabled = process.env.DISABLE_AI_ANALYSIS === 'true';
      const aiResult = aiDisabled
        ? { text: null, error: null }
        : await generateAIAnalysis({
            homeTeam: homeTeam.name,
            awayTeam: awayTeam.name,
            topMarkets: allMarkets.slice(0, 3).map((m) => ({ label: m.label, probability: m.probability })),
            homeForm: homeRecentForm,
            awayForm: awayRecentForm,
            h2hMatches: h2hList,
            homeAvgCorners: homeAvgCorners,
            awayAvgCorners: awayAvgCorners,
            homeAvgCards: homeAvgCards,
            awayAvgCards: awayAvgCards,
            homeInjuriesCount: homeInjuries.length,
            awayInjuriesCount: awayInjuries.length,
          });
      if (aiResult.error) {
        allApiErrors.push({ context: 'analiza AI (Gemini)', match: homeTeam.name + ' - ' + awayTeam.name, message: aiResult.error });
      }`
);

console.log('\\nGata! Acum ruleaza:');
console.log('  git add .');
console.log('  git commit -m "Adauga comutator DISABLE_AI_ANALYSIS pentru a opri Gemini din Vercel"');
console.log('  git push');
