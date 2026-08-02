#!/usr/bin/env node
// Adauga o analiza scrisa (AI) per meci, folosind OpenAI. AI-ul NU
// inventeaza cifre - citeste STRICT statisticile deja calculate
// (probabilitati, forma, H2H, cornere, cartonase, accidentari) si
// scrie o explicatie scurta, semnaland context relevant.
// Daca OPENAI_API_KEY nu e setat, functia returneaza null si totul
// continua normal, fara aceasta sectiune.

const fs = require('fs');
const path = require('path');

function writeFile(relativePath, content) {
  const fullPath = path.join(__dirname, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, { encoding: 'utf8' });
  console.log('Actualizat: ' + relativePath);
}

writeFile('lib/aiAnalysis.ts', `// Genereaza o scurta analiza in limbaj natural, STRICT pe baza datelor
// statistice deja calculate. Foloseste OpenAI (gpt-5.4-mini, ieftin si
// suficient de bun pentru sinteza de text). Daca OPENAI_API_KEY nu e
// setat, functia returneaza null si sistemul continua normal.

interface FormItem {
  result: string;
  opponent: string;
  scoreFor: number;
  scoreAgainst: number;
}

interface H2HItem {
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
}

export interface AIAnalysisInput {
  homeTeam: string;
  awayTeam: string;
  topMarkets: { label: string; probability: number }[];
  homeForm: FormItem[];
  awayForm: FormItem[];
  h2hMatches: H2HItem[];
  homeAvgCorners: number | null;
  awayAvgCorners: number | null;
  homeAvgCards: number | null;
  awayAvgCards: number | null;
  homeInjuriesCount: number;
  awayInjuriesCount: number;
}

const SYSTEM_PROMPT =
  'Esti un analist sportiv care scrie o scurta analiza in limba romana (3-5 propozitii), ' +
  'STRICT pe baza datelor numerice primite. Nu inventa cifre, jucatori sau evenimente care ' +
  'nu apar in date. Mentioneaza recomandarea principala (cea cu cea mai mare probabilitate ' +
  'din lista primita) si semnaleaza daca exista context care ar putea nuanta recomandarea ' +
  '(forma recenta in contradictie cu alte date, accidentari multiple, istoric direct ' +
  'insuficient etc). Fii onest despre incertitudine - nu folosi cuvinte precum "sigur" sau ' +
  '"garantat". Scrie natural si direct, fara introduceri gen "Iata analiza".';

function buildUserPrompt(input: AIAnalysisInput): string {
  const lines: string[] = [];
  lines.push('Meci: ' + input.homeTeam + ' vs ' + input.awayTeam);
  lines.push('');
  lines.push('Top piete calculate (probabilitate model matematic):');
  input.topMarkets.forEach((m) => {
    lines.push('- ' + m.label + ': ' + Math.round(m.probability * 100) + '%');
  });
  lines.push('');

  const homeFormText = input.homeForm.length > 0
    ? input.homeForm.map((f) => f.result + ' (' + f.scoreFor + '-' + f.scoreAgainst + ' vs ' + f.opponent + ')').join(', ')
    : 'indisponibila';
  const awayFormText = input.awayForm.length > 0
    ? input.awayForm.map((f) => f.result + ' (' + f.scoreFor + '-' + f.scoreAgainst + ' vs ' + f.opponent + ')').join(', ')
    : 'indisponibila';

  lines.push('Forma recenta ' + input.homeTeam + ' (cele mai recente primele): ' + homeFormText);
  lines.push('Forma recenta ' + input.awayTeam + ' (cele mai recente primele): ' + awayFormText);
  lines.push('');

  if (input.h2hMatches.length > 0) {
    lines.push('Ultimele confruntari directe: ' + input.h2hMatches.map((h) => h.homeTeam + ' ' + h.homeGoals + '-' + h.awayGoals + ' ' + h.awayTeam).join(', '));
  } else {
    lines.push('Nu exista istoric de confruntari directe recente.');
  }
  lines.push('');

  lines.push('Cornere medii (ultimele 5): ' + input.homeTeam + ' ' + (input.homeAvgCorners !== null ? input.homeAvgCorners.toFixed(1) : 'necunoscut') + ', ' + input.awayTeam + ' ' + (input.awayAvgCorners !== null ? input.awayAvgCorners.toFixed(1) : 'necunoscut'));
  lines.push('Cartonase medii (ultimele 5): ' + input.homeTeam + ' ' + (input.homeAvgCards !== null ? input.homeAvgCards.toFixed(1) : 'necunoscut') + ', ' + input.awayTeam + ' ' + (input.awayAvgCards !== null ? input.awayAvgCards.toFixed(1) : 'necunoscut'));
  lines.push('Accidentari raportate: ' + input.homeTeam + ' ' + input.homeInjuriesCount + ', ' + input.awayTeam + ' ' + input.awayInjuriesCount);

  return lines.join('\\n');
}

export async function generateAIAnalysis(input: AIAnalysisInput): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: 'gpt-5.4-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(input) },
        ],
        max_tokens: 350,
        temperature: 0.4,
      }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const text = data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : null;
    return typeof text === 'string' ? text.trim() : null;
  } catch (err) {
    return null;
  }
}
`);

console.log('lib/aiAnalysis.ts creat. Continui cu route.ts...');

function readFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
}

function replaceInFile(relativePath, oldStr, newStr) {
  const fullPath = path.join(__dirname, relativePath);
  let content = fs.readFileSync(fullPath, 'utf8');
  if (!content.includes(oldStr)) {
    console.log('EROARE: nu am gasit textul de inlocuit in ' + relativePath + '. Scriptul nu poate continua sigur.');
    process.exit(1);
  }
  content = content.split(oldStr).join(newStr);
  fs.writeFileSync(fullPath, content, { encoding: 'utf8' });
  console.log('Actualizat: ' + relativePath);
}

replaceInFile(
  'app/api/sync/route.ts',
  "import { calculateAllMarkets, calculateCornerMarkets, calculateCardMarkets, TeamForm, HeadToHeadStats, LeagueAverages } from '@/lib/poisson';",
  "import { calculateAllMarkets, calculateCornerMarkets, calculateCardMarkets, TeamForm, HeadToHeadStats, LeagueAverages } from '@/lib/poisson';\nimport { generateAIAnalysis } from '@/lib/aiAnalysis';"
);

replaceInFile(
  'app/api/sync/route.ts',
  `        await supabaseAdmin.from('match_analysis').upsert(
          {
            match_id: matchRow.id,
            home_recent_form: homeRecentForm,
            away_recent_form: awayRecentForm,
            h2h_matches: h2hList,
            home_avg_corners: homeAvgCorners,
            away_avg_corners: awayAvgCorners,
            home_avg_cards: homeAvgCards,
            away_avg_cards: awayAvgCards,
            home_injuries: homeInjuries,
            away_injuries: awayInjuries,
          },
          { onConflict: 'match_id' }
        );`,
  `        const aiAnalysisText = await generateAIAnalysis({
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

        await supabaseAdmin.from('match_analysis').upsert(
          {
            match_id: matchRow.id,
            home_recent_form: homeRecentForm,
            away_recent_form: awayRecentForm,
            h2h_matches: h2hList,
            home_avg_corners: homeAvgCorners,
            away_avg_corners: awayAvgCorners,
            home_avg_cards: homeAvgCards,
            away_avg_cards: awayAvgCards,
            home_injuries: homeInjuries,
            away_injuries: awayInjuries,
            ai_analysis: aiAnalysisText,
          },
          { onConflict: 'match_id' }
        );`
);

console.log('route.ts actualizat cu apelul catre AI. Continui cu pagina de meci...');

replaceInFile(
  'app/match/[id]/page.tsx',
  `interface MatchAnalysis {
  home_recent_form: FormEntry[] | null;
  away_recent_form: FormEntry[] | null;
  h2h_matches: H2HEntry[] | null;
  home_avg_corners: number | null;
  away_avg_corners: number | null;
  home_avg_cards: number | null;
  away_avg_cards: number | null;
  home_injuries: InjuryEntry[] | null;
  away_injuries: InjuryEntry[] | null;
}`,
  `interface MatchAnalysis {
  home_recent_form: FormEntry[] | null;
  away_recent_form: FormEntry[] | null;
  h2h_matches: H2HEntry[] | null;
  home_avg_corners: number | null;
  away_avg_corners: number | null;
  home_avg_cards: number | null;
  away_avg_cards: number | null;
  home_injuries: InjuryEntry[] | null;
  away_injuries: InjuryEntry[] | null;
  ai_analysis: string | null;
}`
);

replaceInFile(
  'app/match/[id]/page.tsx',
  ".select('home_recent_form, away_recent_form, h2h_matches, home_avg_corners, away_avg_corners, home_avg_cards, away_avg_cards, home_injuries, away_injuries')",
  ".select('home_recent_form, away_recent_form, h2h_matches, home_avg_corners, away_avg_corners, home_avg_cards, away_avg_cards, home_injuries, away_injuries, ai_analysis')"
);

replaceInFile(
  'app/match/[id]/page.tsx',
  `            {predictions.length > 0 && (
              <>
                <h2 className="text-sm font-semibold text-slate-400 mb-3 uppercase tracking-wide">
                  Top 3 cele mai probabile
                </h2>`,
  `            {analysis && analysis.ai_analysis && (
              <div className="bg-indigo-950/40 border border-indigo-900 rounded-lg px-4 py-3 mb-8">
                <p className="text-xs font-semibold text-indigo-300 mb-2 uppercase tracking-wide">Analiza AI</p>
                <p className="text-sm text-slate-200 leading-relaxed">{analysis.ai_analysis}</p>
              </div>
            )}

            {predictions.length > 0 && (
              <>
                <h2 className="text-sm font-semibold text-slate-400 mb-3 uppercase tracking-wide">
                  Top 3 cele mai probabile
                </h2>`
);

console.log('\nGata! Acum ruleaza:');
console.log('  git add .');
console.log('  git commit -m "Adauga analiza scrisa AI, bazata pe statisticile calculate"');
console.log('  git push');
