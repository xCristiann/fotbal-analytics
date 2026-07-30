'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase';

interface MatchListItem {
  id: string;
  home_team_name: string;
  away_team_name: string;
  kickoff_utc: string;
  league_id: number;
  topProbability: number | null;
  topLabel: string | null;
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

      if (!matchesData) {
        setMatches([]);
        setLoading(false);
        return;
      }

      const enriched: MatchListItem[] = [];
      for (const m of matchesData) {
        const { data: topPrediction } = await supabaseBrowser
          .from('predictions')
          .select('label, probability')
          .eq('match_id', m.id)
          .order('probability', { ascending: false })
          .limit(1)
          .single();

        enriched.push({
          ...m,
          topProbability: topPrediction?.probability ?? null,
          topLabel: topPrediction?.label ?? null,
        });
      }

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
        <h1 className="text-2xl font-semibold mb-6">Analiza meciuri</h1>

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
              {m.topProbability !== null && (
                <div className="text-right">
                  <span className={'inline-block text-xs font-semibold text-white px-2 py-1 rounded ' + probabilityColor(m.topProbability)}>
                    {Math.round(m.topProbability * 100)}%
                  </span>
                  <p className="text-xs text-slate-400 mt-1">{m.topLabel}</p>
                </div>
              )}
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
