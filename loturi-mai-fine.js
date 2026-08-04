#!/usr/bin/env node
// Loturi mai mici (3 ligi in loc de 6) - Champions League + Europa
// League + Conference League singure au sute de meciuri in perioada
// de calificari (august), deci trebuie procesate cu mai mult spatiu.
// Cron ruleaza acum de 6 ori/zi (cate un lot), in loc de 3.

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
  '  const BATCH_SIZE = 6;',
  '  const BATCH_SIZE = 3;'
);

writeFile('vercel.json', `{
  "crons": [
    { "path": "/api/sync?batch=0", "schedule": "0 6 * * *" },
    { "path": "/api/sync?batch=1", "schedule": "10 6 * * *" },
    { "path": "/api/sync?batch=2", "schedule": "20 6 * * *" },
    { "path": "/api/sync?batch=3", "schedule": "30 6 * * *" },
    { "path": "/api/sync?batch=4", "schedule": "40 6 * * *" },
    { "path": "/api/sync?batch=5", "schedule": "50 6 * * *" }
  ]
}
`);

console.log('\\nGata! Acum ruleaza:');
console.log('  git add .');
console.log('  git commit -m "Loturi mai fine (3 ligi), cron pe 6 rulari zilnice"');
console.log('  git push');
