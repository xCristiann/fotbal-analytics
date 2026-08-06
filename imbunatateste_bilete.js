#!/usr/bin/env node
// 1. Reface etichetele combinate: "1 (Gazde)" / "2 (Oaspeti)" in loc de doar 1/2
// 2. Imbunatateste pagina de bilete: interval de zile (nu doar una),
//    filtru de probabilitate minima, cota reala per selectie, buton
//    de copiere rapida a biletului

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

replaceInFile(
  'lib/poisson.ts',
  `    { market: '1X2', selection: '1', label: '1 (victorie gazde)', probability: pHomeWin, fairOdds: 1 / pHomeWin },
    { market: '1X2', selection: 'X', label: 'X (egal)', probability: pDraw, fairOdds: 1 / pDraw },
    { market: '1X2', selection: '2', label: '2 (victorie oaspeti)', probability: pAwayWin, fairOdds: 1 / pAwayWin },`,
  `    { market: '1X2', selection: '1', label: '1 (Gazde) castiga', probability: pHomeWin, fairOdds: 1 / pHomeWin },
    { market: '1X2', selection: 'X', label: 'X - Egal', probability: pDraw, fairOdds: 1 / pDraw },
    { market: '1X2', selection: '2', label: '2 (Oaspeti) castiga', probability: pAwayWin, fairOdds: 1 / pAwayWin },`
);

replaceInFile(
  'lib/poisson.ts',
  `function calculateTeamOverUnderMarkets(
  avg: number | null,
  thresholds: number[],
  marketName: string,
  unitLabel: string,
  teamNumber: '1' | '2'
): MarketProbability[] {
  if (avg === null) return [];

  const markets: MarketProbability[] = [];
  for (const threshold of thresholds) {
    const kMax = Math.floor(threshold);
    let pUnder = 0;
    for (let k = 0; k <= kMax; k++) {
      pUnder += poissonProbability(avg, k);
    }
    pUnder = clampProb(pUnder);
    const pOver = 1 - pUnder;

    markets.push({ market: marketName, selection: teamNumber + '_OVER_' + threshold, label: teamNumber + ' peste ' + threshold + ' ' + unitLabel, probability: pOver, fairOdds: 1 / pOver });
    markets.push({ market: marketName, selection: teamNumber + '_UNDER_' + threshold, label: teamNumber + ' sub ' + threshold + ' ' + unitLabel, probability: pUnder, fairOdds: 1 / pUnder });
  }
  return markets;
}`,
  `function calculateTeamOverUnderMarkets(
  avg: number | null,
  thresholds: number[],
  marketName: string,
  unitLabel: string,
  teamNumber: '1' | '2'
): MarketProbability[] {
  if (avg === null) return [];

  const teamText = teamNumber === '1' ? '1 (Gazde)' : '2 (Oaspeti)';
  const markets: MarketProbability[] = [];
  for (const threshold of thresholds) {
    const kMax = Math.floor(threshold);
    let pUnder = 0;
    for (let k = 0; k <= kMax; k++) {
      pUnder += poissonProbability(avg, k);
    }
    pUnder = clampProb(pUnder);
    const pOver = 1 - pUnder;

    markets.push({ market: marketName, selection: teamNumber + '_OVER_' + threshold, label: teamText + ' peste ' + threshold + ' ' + unitLabel, probability: pOver, fairOdds: 1 / pOver });
    markets.push({ market: marketName, selection: teamNumber + '_UNDER_' + threshold, label: teamText + ' sub ' + threshold + ' ' + unitLabel, probability: pUnder, fairOdds: 1 / pUnder });
  }
  return markets;
}`
);

console.log('lib/poisson.ts actualizat. Continui cu pagina de bilete...');

writeFile('app/tickets/page.tsx', `'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase-browser';

interface PickCandidate {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  label: string;
  probability: number;
  fairOdds: number;
}

interface Ticket {
  size: number;
  selections: PickCandidate[];
  combinedProb: number;
  combinedOdds: number;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return day + '.' + month + ' ' + hh + ':' + mm;
}

function buildTicket(picks: PickCandidate[], n: number): Ticket | null {
  const selected = picks.slice(0, n);
  if (selected.length < n) return null;
  const combinedProb = selected.reduce((acc, p) => acc * p.probability, 1);
  const combinedOdds = selected.reduce((acc, p) => acc * p.fairOdds, 1);
  return { size: n, selections: selected, combinedProb: combinedProb, combinedOdds: combinedOdds };
}

function ticketToText(ticket: Ticket): string {
  const lines = ticket.selections.map((s) => s.homeTeam + ' - ' + s.awayTeam + ' | ' + s.label + ' (' + Math.round(s.probability * 100) + '%, cota ' + s.fairOdds.toFixed(2) + ')');
  lines.push('');
  lines.push('Sansa combinata: ' + Math.round(ticket.combinedProb * 100) + '% | Cota combinata: ' + ticket.combinedOdds.toFixed(2));
  return lines.join('\\n');
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

export default function TicketsPage() {
  const [dateFrom, setDateFrom] = useState(todayStr());
  const [dateTo, setDateTo] = useState(addDaysStr(todayStr(), 2));
  const [minProbability, setMinProbability] = useState(0.7);
  const [allPicks, setAllPicks] = useState<PickCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedTicket, setCopiedTicket] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);

      const startRange = dateFrom + 'T00:00:00';
      const endRange = dateTo + 'T23:59:59';

      const { data: matches } = await supabaseBrowser
        .from('matches')
        .select('id, home_team_name, away_team_name, kickoff_utc')
        .gte('kickoff_utc', startRange)
        .lte('kickoff_utc', endRange);

      if (!matches || matches.length === 0) {
        setAllPicks([]);
        setLoading(false);
        return;
      }

      const matchIds = matches.map((m) => m.id);
      const { data: predictions } = await supabaseBrowser
        .from('predictions')
        .select('match_id, label, probability, fair_odds')
        .in('match_id', matchIds)
        .order('probability', { ascending: false });

      if (!predictions) {
        setAllPicks([]);
        setLoading(false);
        return;
      }

      const bestPerMatch = new Map<string, { label: string; probability: number; fairOdds: number }>();
      for (const p of predictions) {
        if (!bestPerMatch.has(p.match_id)) {
          bestPerMatch.set(p.match_id, { label: p.label, probability: p.probability, fairOdds: p.fair_odds });
        }
      }

      const matchMap = new Map(matches.map((m) => [m.id, m]));
      const candidates: PickCandidate[] = [];
      bestPerMatch.forEach((value, matchId) => {
        const m = matchMap.get(matchId);
        if (!m) return;
        candidates.push({
          matchId: matchId,
          homeTeam: m.home_team_name,
          awayTeam: m.away_team_name,
          kickoff: m.kickoff_utc,
          label: value.label,
          probability: value.probability,
          fairOdds: value.fairOdds,
        });
      });

      candidates.sort((a, b) => b.probability - a.probability);
      setAllPicks(candidates);
      setLoading(false);
    }

    load();
  }, [dateFrom, dateTo]);

  const filteredPicks = allPicks.filter((p) => p.probability >= minProbability);

  const tickets = [2, 3, 4, 5].map((n) => buildTicket(filteredPicks, n)).filter((t): t is Ticket => t !== null);

  async function copyTicket(ticket: Ticket) {
    try {
      await navigator.clipboard.writeText(ticketToText(ticket));
      setCopiedTicket(ticket.size);
      setTimeout(() => setCopiedTicket(null), 2000);
    } catch (e) {
      // clipboard poate fi blocat de browser - ignoram silentios
    }
  }

  function renderTicket(ticket: Ticket) {
    return (
      <div key={ticket.size} className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-200">Bilet cu {ticket.size} selectii</h3>
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-emerald-400">
              {Math.round(ticket.combinedProb * 100)}% | cota {ticket.combinedOdds.toFixed(2)}
            </span>
            <button
              onClick={() => copyTicket(ticket)}
              className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded"
            >
              {copiedTicket === ticket.size ? 'Copiat!' : 'Copiaza'}
            </button>
          </div>
        </div>
        <div className="space-y-2">
          {ticket.selections.map((s) => (
            <div key={s.matchId} className="flex items-center justify-between text-sm border-b border-slate-800 pb-2 last:border-0 last:pb-0">
              <div>
                <p className="text-slate-200">{s.homeTeam} - {s.awayTeam}</p>
                <p className="text-xs text-slate-500">{formatDateTime(s.kickoff)} | {s.label}</p>
              </div>
              <div className="text-right">
                <p className="text-emerald-400 font-semibold text-sm">{Math.round(s.probability * 100)}%</p>
                <p className="text-xs text-slate-500">cota {s.fairOdds.toFixed(2)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 px-4 py-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">Bilete recomandate</h1>
          <Link href="/" className="text-sm text-slate-400 hover:text-slate-200">Inapoi la meciuri</Link>
        </div>

        <div className="flex flex-wrap gap-3 mb-6">
          <div>
            <label className="block text-xs text-slate-500 mb-1">De la</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Pana la</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Sansa minima</label>
            <select
              value={minProbability}
              onChange={(e) => setMinProbability(Number(e.target.value))}
              className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm"
            >
              <option value={0.6}>Peste 60%</option>
              <option value={0.7}>Peste 70%</option>
              <option value={0.8}>Peste 80%</option>
              <option value={0.9}>Peste 90%</option>
            </select>
          </div>
        </div>

        {loading && <p className="text-slate-400 text-sm">Se incarca...</p>}

        {!loading && filteredPicks.length === 0 && (
          <p className="text-slate-500 text-sm">Nu exista predictii care sa treaca de pragul ales, in acest interval.</p>
        )}

        {!loading && filteredPicks.length > 0 && (
          <>
            {tickets.length === 0 && (
              <p className="text-slate-500 text-sm mb-6">
                Doar {filteredPicks.length} selectii disponibile peste pragul ales - nu sunt destule pentru un bilet de minim 2. Scade pragul de sansa minima sau largeste intervalul de zile.
              </p>
            )}

            {tickets.map((t) => renderTicket(t))}

            <h2 className="text-sm font-semibold text-slate-400 mb-3 uppercase tracking-wide mt-8">
              Toate selectiile disponibile ({filteredPicks.length}), sortate dupa sansa
            </h2>
            <div className="space-y-1">
              {filteredPicks.map((p) => (
                <div key={p.matchId} className="flex items-center justify-between text-sm px-3 py-2 border-b border-slate-900">
                  <div>
                    <span className="text-slate-300">{p.homeTeam} - {p.awayTeam}</span>
                    <span className="text-slate-500 text-xs ml-2">{formatDateTime(p.kickoff)} | {p.label}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-300 text-sm">{Math.round(p.probability * 100)}%</span>
                    <span className="text-slate-600 text-xs ml-2">({p.fairOdds.toFixed(2)})</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
`);

console.log('\nGata! Acum ruleaza:');
console.log('  git add .');
console.log('  git commit -m "Reface etichete 1/Gazde+2/Oaspeti, imbunatateste pagina de bilete"');
console.log('  git push');
