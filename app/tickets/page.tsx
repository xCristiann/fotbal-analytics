'use client';

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
}

interface Ticket {
  selections: PickCandidate[];
  combinedProb: number;
  combinedOdds: number;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
}

function buildTicket(picks: PickCandidate[], n: number): Ticket | null {
  const selected = picks.slice(0, n);
  if (selected.length < n) return null;
  const combinedProb = selected.reduce((acc, p) => acc * p.probability, 1);
  const combinedOdds = selected.reduce((acc, p) => acc * (1 / p.probability), 1);
  return { selections: selected, combinedProb: combinedProb, combinedOdds: combinedOdds };
}

export default function TicketsPage() {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [picks, setPicks] = useState<PickCandidate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);

      const startOfDay = selectedDate + 'T00:00:00';
      const endOfDay = selectedDate + 'T23:59:59';

      const { data: matches } = await supabaseBrowser
        .from('matches')
        .select('id, home_team_name, away_team_name, kickoff_utc')
        .gte('kickoff_utc', startOfDay)
        .lte('kickoff_utc', endOfDay);

      if (!matches || matches.length === 0) {
        setPicks([]);
        setLoading(false);
        return;
      }

      const matchIds = matches.map((m) => m.id);
      const { data: predictions } = await supabaseBrowser
        .from('predictions')
        .select('match_id, label, probability')
        .in('match_id', matchIds)
        .order('probability', { ascending: false });

      if (!predictions) {
        setPicks([]);
        setLoading(false);
        return;
      }

      const bestPerMatch = new Map<string, { label: string; probability: number }>();
      for (const p of predictions) {
        if (!bestPerMatch.has(p.match_id)) {
          bestPerMatch.set(p.match_id, { label: p.label, probability: p.probability });
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
        });
      });

      candidates.sort((a, b) => b.probability - a.probability);
      setPicks(candidates);
      setLoading(false);
    }

    load();
  }, [selectedDate]);

  const ticket2 = buildTicket(picks, 2);
  const ticket3 = buildTicket(picks, 3);
  const ticket4 = buildTicket(picks, 4);

  function renderTicket(title: string, ticket: Ticket | null) {
    if (!ticket) return null;
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
          <span className="text-xs font-semibold text-emerald-400">
            Sansa combinata: {Math.round(ticket.combinedProb * 100)}% | Cota: {ticket.combinedOdds.toFixed(2)}
          </span>
        </div>
        <div className="space-y-2">
          {ticket.selections.map((s) => (
            <div key={s.matchId} className="flex items-center justify-between text-sm border-b border-slate-800 pb-2 last:border-0 last:pb-0">
              <div>
                <p className="text-slate-200">{s.homeTeam} - {s.awayTeam}</p>
                <p className="text-xs text-slate-500">{formatTime(s.kickoff)} | {s.label}</p>
              </div>
              <span className="text-emerald-400 font-semibold">{Math.round(s.probability * 100)}%</span>
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

        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm mb-6"
        />

        {loading && <p className="text-slate-400 text-sm">Se incarca...</p>}

        {!loading && picks.length === 0 && (
          <p className="text-slate-500 text-sm">Nu exista predictii pentru aceasta zi inca.</p>
        )}

        {!loading && picks.length > 0 && (
          <>
            {!ticket2 && <p className="text-slate-500 text-sm mb-6">Nu sunt inca destule meciuri analizate pentru a propune bilete.</p>}

            {renderTicket('Bilet cu 2 selectii (cea mai sigura varianta)', ticket2)}
            {renderTicket('Bilet cu 3 selectii', ticket3)}
            {renderTicket('Bilet cu 4 selectii (risc mai mare)', ticket4)}

            <h2 className="text-sm font-semibold text-slate-400 mb-3 uppercase tracking-wide mt-8">
              Toate selectiile disponibile, sortate dupa sansa
            </h2>
            <div className="space-y-1">
              {picks.map((p) => (
                <div key={p.matchId} className="flex items-center justify-between text-sm px-3 py-2 border-b border-slate-900">
                  <div>
                    <span className="text-slate-300">{p.homeTeam} - {p.awayTeam}</span>
                    <span className="text-slate-500 text-xs ml-2">{p.label}</span>
                  </div>
                  <span className="text-slate-400">{Math.round(p.probability * 100)}%</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
