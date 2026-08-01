#!/usr/bin/env node
// Adauga un raport detaliat de debug in raspunsul /api/sync: numarul
// exact de rezultate gasite la fiecare tip de cerere (H2H, forma,
// cornere, accidentari), per meci analizat. Fara asta, ghicim; cu
// asta, vedem exact unde se opreste datele.

const fs = require('fs');
const path = require('path');

function readFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
}

function writeFile(relativePath, content) {
  const fullPath = path.join(__dirname, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, { encoding: 'utf8' });
  console.log('Actualizat: ' + relativePath);
}

let content = readFile('app/api/sync/route.ts');

// Adaugam un array de debug info
content = content.replace(
  "const allApiErrors: any[] = [];",
  "const allApiErrors: any[] = [];\n  const debugInfo: any[] = [];"
);

// Dupa ce gasim h2hFixturesRaw, home/awayFixturesRaw, corners, injuries -
// inseram inregistrarea de debug chiar inainte de upsert-ul in match_analysis
content = content.replace(
  "        await supabaseAdmin.from('match_analysis').upsert(",
  `        debugInfo.push({
          match: homeTeam.name + ' - ' + awayTeam.name,
          season: fixtureSeason,
          dayBeforeMatch: dayBeforeMatch,
          h2hFixturesRawCount: h2hFixturesRaw.length,
          homeFixturesRawCount: homeFixturesRaw.length,
          awayFixturesRawCount: awayFixturesRaw.length,
          homeRecentFormCount: homeRecentForm.length,
          awayRecentFormCount: awayRecentForm.length,
          homeAvgCorners: homeAvgCorners,
          awayAvgCorners: awayAvgCorners,
          homeInjuriesCount: homeInjuries.length,
          awayInjuriesCount: awayInjuries.length,
        });

        await supabaseAdmin.from('match_analysis').upsert(`
);

// Includem debugInfo in raspunsul final
content = content.replace(
  "    apiErrors: allApiErrors.slice(0, 15),\n  });",
  "    apiErrors: allApiErrors.slice(0, 15),\n    debugInfo: debugInfo,\n  });"
);

writeFile('app/api/sync/route.ts', content);

console.log('\\nGata! Acum ruleaza:');
console.log('  git add .');
console.log('  git commit -m "Adauga raport de debug detaliat in /api/sync"');
console.log('  git push');
