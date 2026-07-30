#!/usr/bin/env node
// Repara bug-ul "supabaseKey is required": desparte clientul Supabase
// in doua fisiere separate (unul pentru server, unul pentru browser),
// ca sa nu se mai scurga cheia secreta (service_role) in bundle-ul de client.

const fs = require('fs');
const path = require('path');

function writeFile(relativePath, content) {
  const fullPath = path.join(__dirname, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, { encoding: 'utf8' });
  console.log('Scris: ' + relativePath);
}

function replaceInFile(relativePath, oldStr, newStr) {
  const fullPath = path.join(__dirname, relativePath);
  if (!fs.existsSync(fullPath)) {
    console.log('ATENTIE: nu gasesc fisierul ' + relativePath);
    return;
  }
  let content = fs.readFileSync(fullPath, 'utf8');
  if (!content.includes(oldStr)) {
    console.log('ATENTIE: nu am gasit textul de inlocuit in ' + relativePath + ' (poate a fost deja reparat)');
    return;
  }
  content = content.split(oldStr).join(newStr);
  fs.writeFileSync(fullPath, content, { encoding: 'utf8' });
  console.log('Actualizat: ' + relativePath);
}

writeFile('lib/supabase-admin.ts', `import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Folosit DOAR pe server (cron, API routes). NU importa asta niciodata
// dintr-un fisier cu 'use client' - cheia service_role nu trebuie sa
// ajunga in bundle-ul de browser.
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});
`);

writeFile('lib/supabase-browser.ts', `import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Folosit in browser (componente 'use client'). Foloseste doar cheia
// publica (anon), niciodata service_role.
export const supabaseBrowser = createClient(supabaseUrl, supabaseAnonKey);
`);

const oldFile = path.join(__dirname, 'lib/supabase.ts');
if (fs.existsSync(oldFile)) {
  fs.unlinkSync(oldFile);
  console.log('Sters: lib/supabase.ts (inlocuit de fisierele separate de mai sus)');
}

replaceInFile('app/api/sync/route.ts', "import { supabaseAdmin } from '@/lib/supabase';", "import { supabaseAdmin } from '@/lib/supabase-admin';");
replaceInFile('app/page.tsx', "import { supabaseBrowser } from '@/lib/supabase';", "import { supabaseBrowser } from '@/lib/supabase-browser';");
replaceInFile('app/match/[id]/page.tsx', "import { supabaseBrowser } from '@/lib/supabase';", "import { supabaseBrowser } from '@/lib/supabase-browser';");

console.log('\\nGata! Acum ruleaza:');
console.log('  git add .');
console.log('  git commit -m "Fix: separa clientul Supabase pentru server si browser"');
console.log('  git push');
