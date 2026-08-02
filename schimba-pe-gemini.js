#!/usr/bin/env node
// Inlocuieste OpenAI cu Google Gemini pentru analiza AI - complet
// gratuit, fara card, 1500 cereri/zi (mult peste ce ne trebuie).

const fs = require('fs');
const path = require('path');

function writeFile(relativePath, content) {
  const fullPath = path.join(__dirname, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, { encoding: 'utf8' });
  console.log('Actualizat: ' + relativePath);
}

writeFile('lib/aiAnalysis.ts', `// Genereaza o scurta analiza in limbaj natural, STRICT pe baza datelor
// statistice deja calculate. Foloseste Google Gemini (gratuit, fara
// card, 1500 cereri/zi pe planul free - mult peste ce ne trebuie).
// Daca GEMINI_API_KEY nu e setat, functia returneaza null si sistemul
// continua normal.

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
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  try {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildUserPrompt(input) }] }],
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: { temperature: 0.4, maxOutputTokens: 350 },
      }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const text = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0]
      ? data.candidates[0].content.parts[0].text
      : null;
    return typeof text === 'string' ? text.trim() : null;
  } catch (err) {
    return null;
  }
}
`);

console.log('\\nGata! Acum ruleaza:');
console.log('  git add .');
console.log('  git commit -m "Trece analiza AI de pe OpenAI pe Google Gemini (gratuit)"');
console.log('  git push');
