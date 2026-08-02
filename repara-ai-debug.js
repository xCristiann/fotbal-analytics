#!/usr/bin/env node
// Repara silent-fail-ul de la generateAIAnalysis: acum returneaza si
// eroarea exacta (daca exista), ca sa apara in apiErrors din raspunsul
// /api/sync, nu doar "nu s-a intamplat nimic".

const fs = require('fs');
const path = require('path');

function writeFile(relativePath, content) {
  const fullPath = path.join(__dirname, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, { encoding: 'utf8' });
  console.log('Actualizat: ' + relativePath);
}

function readFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
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

writeFile('lib/aiAnalysis.ts', `// Genereaza o scurta analiza in limbaj natural, STRICT pe baza datelor
// statistice deja calculate. Foloseste Google Gemini (gratuit, fara
// card). Returneaza si eroarea exacta, daca apare ceva - nu mai
// esueaza silentios.

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

export interface AIAnalysisResult {
  text: string | null;
  error: string | null;
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

export async function generateAIAnalysis(input: AIAnalysisInput): Promise<AIAnalysisResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { text: null, error: 'GEMINI_API_KEY nu este setat in variabilele de mediu' };
  }

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

    const data = await res.json();

    if (!res.ok) {
      const errMsg = data && data.error && data.error.message ? data.error.message : ('HTTP ' + res.status);
      return { text: null, error: 'Gemini a raspuns cu eroare: ' + errMsg };
    }

    const text = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0]
      ? data.candidates[0].content.parts[0].text
      : null;

    if (typeof text !== 'string' || text.trim().length === 0) {
      return { text: null, error: 'Gemini a raspuns 200 OK dar fara text util. Raspuns brut: ' + JSON.stringify(data).slice(0, 300) };
    }

    return { text: text.trim(), error: null };
  } catch (err: any) {
    return { text: null, error: 'Exceptie la apelul Gemini: ' + (err && err.message ? err.message : String(err)) };
  }
}
`);

replaceInFile(
  'app/api/sync/route.ts',
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
        });`,
  `        const aiResult = await generateAIAnalysis({
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
        const aiAnalysisText = aiResult.text;
        if (aiResult.error) {
          allApiErrors.push({ context: 'analiza AI (Gemini)', match: homeTeam.name + ' - ' + awayTeam.name, message: aiResult.error });
        }`
);

console.log('\\nGata! Acum ruleaza:');
console.log('  git add .');
console.log('  git commit -m "Repara silent-fail la analiza AI, adauga erori explicite"');
console.log('  git push');
