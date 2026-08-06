#!/usr/bin/env node
// Pe pagina principala, in loc de un singur pronostic per meci, arata
// minim 2: cel mai bun per total, plus garantat unul de cornere (daca
// exista date de cornere pentru acel meci).

const fs = require('fs');
const path = require('path');

function writeFile(relativePath, content) {
  const fullPath = path.join(__dirname, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, { encoding: 'utf8' });
  console.log('Actualizat: ' + relativePath);
}

writeFile('app/page.tsx', `'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase-browser';

interface Prediction {
  market: string;
  label: string;
  probability: number;
}

interface MatchListItem {
  id: string;
  home_team_name: string;
  away_team_name: string;
  kickoff_utc: string;
  league_id: number;
  displayPicks: Prediction[];
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
}

function probabilityColor(prob: number): string {
  if (prob >= 0.9) return 'bg-emerald-500';
  if (prob >= 0.8) return 'bg-lime-500';
  if (prob >= 0.7) return 'bg-yellow-500';
  return 'bg-slate-500';
}

// Alege ce 2 pronosticuri sa afiseze: cel mai bun per total, plus
// garantat unul de cornere daca exista date pentru acel meci.
function pickDisplayPredictions(predictions: Prediction[]): Prediction[] {
  if (predictions.length === 0) return [];

  const top = predictions[0];
  const bestCorner = predictions.find((p) => p.market === 'CORNERS');

  if (bestCorner && bestCorner.label !== top.label) {
    return [top, bestCorner];
  }

  if (predictions.length > 1) {
    return [top, predictions[1]];
  }

  return [top];
}

export default function HomePage() {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [searchTerm, setSearchTerm] = useState('');
  const [matches, setMatches] = useState<MatchListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadMatches() {
      setLoading(true);

      const startOfDay = selectedDate + 'T00:00:00';
      const endOfDay = selectedDate + 'T23:59:59';

      const { data: matchesData } = await supabaseBrowser
        .from('matches')
        .select('id, home_team_name, away_team_name, kickoff_utc, league_id')
        .gte('kickoff_utc', startOfDay)
        .lte('kickoff_utc', endOfDay)
        .order('kickoff_utc', { ascending: true });

      if (!matchesData || matchesData.length === 0) {
        setMatches([]);
        setLoading(false);
        return;
      }

      const matchIds = matchesData.map((m) => m.id);
      const { data: predictionsData } = await supabaseBrowser
        .from('predictions')
        .select('match_id, market, label, probability')
        .in('match_id', matchIds)
        .order('probability', { ascending: false });

      const predictionsByMatch = new Map<string, Prediction[]>();
      (predictionsData || []).forEach((p: any) => {
        const list = predictionsByMatch.get(p.match_id) || [];
        list.push({ market: p.market, label: p.label, probability: p.probability });
        predictionsByMatch.set(p.match_id, list);
      });

      const enriched: MatchListItem[] = matchesData.map((m) => ({
        ...m,
        displayPicks: pickDisplayPredictions(predictionsByMatch.get(m.id) || []),
      }));

      setMatches(enriched);
      setLoading(false);
    }

    loadMatches();
  }, [selectedDate]);

  const filteredMatches = matches.filter((m) => {
    const term = searchTerm.toLowerCase();
    return (
      m.home_team_name.toLowerCase().includes(term) ||
      m.away_team_name.toLowerCase().includes(term)
    );
  });

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 px-4 py-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">Analiza meciuri</h1>
          <Link href="/tickets" className="text-sm text-emerald-400 hover:text-emerald-300">Bilete recomandate</Link>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="Cauta o echipa..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm"
          />
        </div>

        {loading && <p className="text-slate-400 text-sm">Se incarca meciurile...</p>}

        {!loading && filteredMatches.length === 0 && (
          <p className="text-slate-400 text-sm">Nu exista meciuri pentru aceasta zi.</p>
        )}

        <div className="space-y-2">
          {filteredMatches.map((m) => (
            <Link
              key={m.id}
              href={'/match/' + m.id}
              className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-lg px-4 py-3 hover:border-slate-600 transition"
            >
              <div>
                <p className="text-sm font-medium">{m.home_team_name} - {m.away_team_name}</p>
                <p className="text-xs text-slate-500">{formatTime(m.kickoff_utc)}</p>
              </div>
              <div className="flex flex-col gap-1.5 items-end">
                {m.displayPicks.map((p, idx) => (
                  <div key={idx} className="text-right">
                    <span className={'inline-block text-xs font-semibold text-white px-2 py-1 rounded ' + probabilityColor(p.probability)}>
                      {Math.round(p.probability * 100)}%
                    </span>
                    <p className="text-xs text-slate-400 mt-0.5">{p.label}</p>
                  </div>
                ))}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
`);

console.log('\nGata! Acum ruleaza:');
console.log('  git add .');
console.log('  git commit -m "Arata minim 2 pronosticuri per meci, garantat unul de cornere"');
console.log('  git push');
