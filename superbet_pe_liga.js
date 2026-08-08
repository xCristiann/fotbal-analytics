#!/usr/bin/env node
// Link-uri specifice pe liga catre Superbet, in loc de link-ul general.
// Confirmate prin cautare: Premier League, La Liga, Serie A, Bundesliga,
// Ligue 1, Liga 1 Romania, Champions League, Eredivisie.
// Deduse dupa tipar (Champions League -> Europa/Conference League),
// marcate explicit ca atare.
// Restul ligilor: fallback pe pagina generala de fotbal live.

const fs = require('fs');
const path = require('path');

function writeFile(relativePath, content) {
  const fullPath = path.join(__dirname, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, { encoding: 'utf8' });
  console.log('Actualizat: ' + relativePath);
}

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

writeFile('lib/superbetLinks.ts', `// Link-uri catre paginile de liga de pe Superbet.ro.
// CONFIRMATE prin verificare directa: 39, 140, 135, 78, 61, 283, 2, 88.
// DEDUSE dupa tiparul confirmat la Champions League (3, 848) - ar
// trebui sa fie corecte, dar nu au fost verificate direct.
// Restul: fallback pe pagina generala de fotbal live.

const SUPERBET_LEAGUE_URLS: Record<number, string> = {
  39: 'https://superbet.ro/pariuri-sportive/fotbal/anglia/premier-league/toate',
  140: 'https://superbet.ro/pariuri-sportive/fotbal/spania/laliga/toate',
  135: 'https://superbet.ro/pariuri-sportive/fotbal/italia/serie-a/toate',
  78: 'https://superbet.ro/pariuri-sportive/fotbal/germania/bundesliga/toate',
  61: 'https://superbet.ro/pariuri-sportive/fotbal/franta/ligue-1/toate',
  283: 'https://superbet.ro/pariuri-sportive/fotbal/romania/superliga/toate',
  2: 'https://superbet.ro/pariuri-sportive/fotbal/international-cluburi/uefa-liga-campionilor/toate',
  88: 'https://superbet.ro/pariuri-sportive/fotbal/olanda/eredivisie/toate',
  // deduse dupa tipar, neverificate direct:
  3: 'https://superbet.ro/pariuri-sportive/fotbal/international-cluburi/uefa-europa-league/toate',
  848: 'https://superbet.ro/pariuri-sportive/fotbal/international-cluburi/uefa-conference-league/toate',
};

const SUPERBET_FALLBACK_URL = 'https://superbet.ro/pariuri-sportive/fotbal/live';

export function getSuperbetLink(leagueId: number): string {
  return SUPERBET_LEAGUE_URLS[leagueId] || SUPERBET_FALLBACK_URL;
}
`);

console.log('lib/superbetLinks.ts creat. Continui cu paginile...');

replaceInFile(
  'app/page.tsx',
  `import { supabaseBrowser } from '@/lib/supabase-browser';`,
  `import { supabaseBrowser } from '@/lib/supabase-browser';\nimport { getSuperbetLink } from '@/lib/superbetLinks';`
);

replaceInFile(
  'app/page.tsx',
  `            <a
              href="https://superbet.ro/pariuri-sportive/live"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-orange-400 hover:text-orange-300"
            >
              Superbet ↗
            </a>`,
  `            <a
              href="https://superbet.ro/pariuri-sportive/fotbal/live"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-orange-400 hover:text-orange-300"
            >
              Superbet ↗
            </a>`
);

replaceInFile(
  'app/page.tsx',
  `              <div className="flex flex-col gap-1.5 items-end">
                {m.displayPicks.map((p, idx) => (`,
  `              <div className="flex flex-col gap-1.5 items-end">
                <a
                  href={getSuperbetLink(m.league_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-xs text-orange-400 hover:text-orange-300 mb-0.5"
                >
                  Superbet ↗
                </a>
                {m.displayPicks.map((p, idx) => (`
);

replaceInFile(
  'app/match/[id]/page.tsx',
  `import { supabaseBrowser } from '@/lib/supabase-browser';`,
  `import { supabaseBrowser } from '@/lib/supabase-browser';\nimport { getSuperbetLink } from '@/lib/superbetLinks';`
);

replaceInFile(
  'app/match/[id]/page.tsx',
  `interface MatchDetail {
  home_team_name: string;
  away_team_name: string;
  kickoff_utc: string;
}`,
  `interface MatchDetail {
  home_team_name: string;
  away_team_name: string;
  kickoff_utc: string;
  league_id: number;
}`
);

replaceInFile(
  'app/match/[id]/page.tsx',
  `        .select('home_team_name, away_team_name, kickoff_utc')`,
  `        .select('home_team_name, away_team_name, kickoff_utc, league_id')`
);

replaceInFile(
  'app/match/[id]/page.tsx',
  `              <a
                href="https://superbet.ro/pariuri-sportive/live"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-orange-400 hover:text-orange-300 whitespace-nowrap ml-3"
              >
                Vezi pe Superbet ↗
              </a>`,
  `              <a
                href={getSuperbetLink(match.league_id)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-orange-400 hover:text-orange-300 whitespace-nowrap ml-3"
              >
                Vezi pe Superbet ↗
              </a>`
);

console.log('\nGata! Acum ruleaza:');
console.log('  git add .');
console.log('  git commit -m "Link Superbet specific per liga, confirmat prin cautare directa"');
console.log('  git push');
