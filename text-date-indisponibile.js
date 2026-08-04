#!/usr/bin/env node
// Inlocuieste "-" (derutant, pare eroare) cu "date indisponibile"
// pentru cornere/cartonase lipsa, ca sa fie clar ca nu e o eroare a
// noastra, ci pur si simplu API-Football nu are aceste statistici
// pentru liga/echipa respectiva.

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
  'app/match/[id]/page.tsx',
  `                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-slate-400">Cornere</span>
                      <span className="font-semibold">{analysis.home_avg_corners !== null ? analysis.home_avg_corners.toFixed(1) : '-'}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Cartonase</span>
                      <span className="font-semibold">{analysis.home_avg_cards !== null ? analysis.home_avg_cards.toFixed(1) : '-'}</span>
                    </div>`,
  `                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-slate-400">Cornere</span>
                      <span className="font-semibold">{analysis.home_avg_corners !== null ? analysis.home_avg_corners.toFixed(1) : <span className="text-xs text-slate-600">date indisponibile</span>}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Cartonase</span>
                      <span className="font-semibold">{analysis.home_avg_cards !== null ? analysis.home_avg_cards.toFixed(1) : <span className="text-xs text-slate-600">date indisponibile</span>}</span>
                    </div>`
);

replaceInFile(
  'app/match/[id]/page.tsx',
  `                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-slate-400">Cornere</span>
                      <span className="font-semibold">{analysis.away_avg_corners !== null ? analysis.away_avg_corners.toFixed(1) : '-'}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Cartonase</span>
                      <span className="font-semibold">{analysis.away_avg_cards !== null ? analysis.away_avg_cards.toFixed(1) : '-'}</span>
                    </div>`,
  `                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-slate-400">Cornere</span>
                      <span className="font-semibold">{analysis.away_avg_corners !== null ? analysis.away_avg_corners.toFixed(1) : <span className="text-xs text-slate-600">date indisponibile</span>}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Cartonase</span>
                      <span className="font-semibold">{analysis.away_avg_cards !== null ? analysis.away_avg_cards.toFixed(1) : <span className="text-xs text-slate-600">date indisponibile</span>}</span>
                    </div>`
);

console.log('\\nGata! Acum ruleaza:');
console.log('  git add .');
console.log('  git commit -m "Text clar pentru date indisponibile la cornere/cartonase"');
console.log('  git push');
