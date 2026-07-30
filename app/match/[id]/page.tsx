'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';

interface Prediction {
  market: string;
  selection: string;
  label: string;
  probability: number;
  fair_odds: number;
}

interface OddRow {
  bookmaker: string;
  market: string;
  selection: string;
  odd_value: number;
}

interface MatchDetail {
  home_team_name: string;
  away_team_name: string;
  kickoff_utc: string;
}

function probabilityBadgeClass(prob: number): string {
  if (prob >= 0.9) return 'bg-emerald-500';
  if (prob >= 0.8) return 'bg-lime-500';
  if (prob >= 0.7) return 'bg-yellow-500';
  return 'bg-slate-600';
}

export default function MatchDetailPage() {
  const params = useParams();
  const matchId = params.id as string;

  const [match, setMatch] = useState<MatchDetail | null>(null);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [odds, setOdds] = useState<OddRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      setLoading(true);

      const { data: matchData } = await supabaseBrowser
        .from('matches')
        .select('home_team_name, away_team_name, kickoff_utc')
        .eq('id', matchId)
        .single();

      const { data: predictionsData } = await supabaseBrowser
        .from('predictions')
        .select('market, selection, label, probability, fair_odds')
        .eq('match_id', matchId)
        .order('probability', { ascending: false });

      const { data: oddsData } = await supabaseBrowser
        .from('odds')
        .select('bookmaker, market, selection, odd_value')
        .eq('match_id', matchId);

      setMatch(matchData);
      setPredictions(predictionsData || []);
      setOdds(oddsData || []);
      setLoading(false);
    }

    loadData();
  }, [matchId]);

  function findBestOdd(market: string, selection: string): number | null {
    const relevant = odds.filter((o) => o.market === market && o.selection === selection);
    if (relevant.length === 0) return null;
    return Math.max(...relevant.map((o) => o.odd_value));
  }

  const top3 = predictions.slice(0, 3);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 px-4 py-8">
      <div className="max-w-2xl mx-auto">
        {loading && <p className="text-slate-400 text-sm">Se incarca...</p>}

        {!loading && match && (
          <>
            <h1 className="text-xl font-semibold mb-1">
              {match.home_team_name} - {match.away_team_name}
            </h1>
            <p className="text-sm text-slate-500 mb-6">
              {new Date(match.kickoff_utc).toLocaleString('ro-RO')}
            </p>

            <h2 className="text-sm font-semibold text-slate-400 mb-3 uppercase tracking-wide">
              Top 3 cele mai probabile
            </h2>
            <div className="space-y-2 mb-8">
              {top3.map((p) => (
                <div
                  key={p.market + p.selection}
                  className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-lg px-4 py-3"
                >
                  <span className="text-sm">{p.label}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-400">
                      cota reala: {findBestOdd(p.market, p.selection) ?? '-'}
                    </span>
                    <span className={'text-xs font-semibold text-white px-2 py-1 rounded ' + probabilityBadgeClass(p.probability)}>
                      {Math.round(p.probability * 100)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <h2 className="text-sm font-semibold text-slate-400 mb-3 uppercase tracking-wide">
              Toate pietele
            </h2>
            <div className="space-y-1">
              {predictions.map((p) => (
                <div
                  key={p.market + p.selection + '-all'}
                  className="flex items-center justify-between text-sm px-4 py-2 border-b border-slate-900"
                >
                  <span className="text-slate-300">{p.label}</span>
                  <span className="text-slate-500">{Math.round(p.probability * 100)}%</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
