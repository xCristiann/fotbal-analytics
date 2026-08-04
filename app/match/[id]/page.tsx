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

interface FormEntry {
  date: string;
  opponent: string;
  venue: string;
  scoreFor: number;
  scoreAgainst: number;
  result: string;
}

interface H2HEntry {
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
}

interface InjuryEntry {
  playerName: string;
  reason: string;
}

interface MatchAnalysis {
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
}

function probabilityBadgeClass(prob: number): string {
  if (prob >= 0.9) return 'bg-emerald-500';
  if (prob >= 0.8) return 'bg-lime-500';
  if (prob >= 0.7) return 'bg-yellow-500';
  return 'bg-slate-600';
}

function resultBadgeClass(result: string): string {
  if (result === 'W') return 'bg-emerald-500';
  if (result === 'L') return 'bg-red-500';
  return 'bg-slate-500';
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return d.getDate().toString().padStart(2, '0') + '.' + (d.getMonth() + 1).toString().padStart(2, '0') + '.' + d.getFullYear();
}

export default function MatchDetailPage() {
  const params = useParams();
  const matchId = params.id as string;

  const [match, setMatch] = useState<MatchDetail | null>(null);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [odds, setOdds] = useState<OddRow[]>([]);
  const [analysis, setAnalysis] = useState<MatchAnalysis | null>(null);
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

      const { data: analysisData } = await supabaseBrowser
        .from('match_analysis')
        .select('home_recent_form, away_recent_form, h2h_matches, home_avg_corners, away_avg_corners, home_avg_cards, away_avg_cards, home_injuries, away_injuries, ai_analysis')
        .eq('match_id', matchId)
        .maybeSingle();

      setMatch(matchData);
      setPredictions(predictionsData || []);
      setOdds(oddsData || []);
      setAnalysis(analysisData || null);
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

            {predictions.length === 0 && (
              <p className="text-slate-500 text-sm mb-6">
                Analiza completa nu a fost inca facuta pentru acest meci (se completeaza treptat, la urmatoarele sincronizari).
              </p>
            )}

            {analysis && analysis.ai_analysis && (
              <div className="bg-indigo-950/40 border border-indigo-900 rounded-lg px-4 py-3 mb-8">
                <p className="text-xs font-semibold text-indigo-300 mb-2 uppercase tracking-wide">Analiza AI</p>
                <p className="text-sm text-slate-200 leading-relaxed">{analysis.ai_analysis}</p>
              </div>
            )}

            {predictions.length > 0 && (
              <>
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
                <div className="space-y-1 mb-8">
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

            {analysis && (analysis.home_recent_form || analysis.away_recent_form) && (
              <>
                <h2 className="text-sm font-semibold text-slate-400 mb-3 uppercase tracking-wide">
                  Forma recenta (ultimele 5 meciuri)
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
                  <div>
                    <p className="text-xs text-slate-500 mb-2">{match.home_team_name}</p>
                    <div className="space-y-1">
                      {(analysis.home_recent_form || []).map((f, i) => (
                        <div key={i} className="flex items-center justify-between text-xs bg-slate-900 border border-slate-800 rounded px-3 py-2">
                          <span className={'w-5 h-5 flex items-center justify-center rounded-full text-white font-bold ' + resultBadgeClass(f.result)}>{f.result}</span>
                          <span className="text-slate-400 flex-1 px-2 truncate">vs {f.opponent}</span>
                          <span className="text-slate-500">{f.scoreFor}-{f.scoreAgainst}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-2">{match.away_team_name}</p>
                    <div className="space-y-1">
                      {(analysis.away_recent_form || []).map((f, i) => (
                        <div key={i} className="flex items-center justify-between text-xs bg-slate-900 border border-slate-800 rounded px-3 py-2">
                          <span className={'w-5 h-5 flex items-center justify-center rounded-full text-white font-bold ' + resultBadgeClass(f.result)}>{f.result}</span>
                          <span className="text-slate-400 flex-1 px-2 truncate">vs {f.opponent}</span>
                          <span className="text-slate-500">{f.scoreFor}-{f.scoreAgainst}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}

            {analysis && analysis.h2h_matches && analysis.h2h_matches.length > 0 && (
              <>
                <h2 className="text-sm font-semibold text-slate-400 mb-3 uppercase tracking-wide">
                  Ultimele confruntari directe
                </h2>
                <div className="space-y-1 mb-8">
                  {analysis.h2h_matches.map((h, i) => (
                    <div key={i} className="flex items-center justify-between text-xs bg-slate-900 border border-slate-800 rounded px-3 py-2">
                      <span className="text-slate-500">{formatShortDate(h.date)}</span>
                      <span className="text-slate-300">{h.homeTeam} {h.homeGoals} - {h.awayGoals} {h.awayTeam}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {analysis && (analysis.home_avg_corners !== null || analysis.away_avg_corners !== null || analysis.home_avg_cards !== null || analysis.away_avg_cards !== null) && (
              <>
                <h2 className="text-sm font-semibold text-slate-400 mb-3 uppercase tracking-wide">
                  Medii (ultimele 5 meciuri)
                </h2>
                <div className="grid grid-cols-2 gap-4 mb-8">
                  <div className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-3">
                    <p className="text-xs text-slate-500 mb-2">{match.home_team_name}</p>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-slate-400">Cornere</span>
                      <span className="font-semibold">{analysis.home_avg_corners !== null ? analysis.home_avg_corners.toFixed(1) : <span className="text-xs text-slate-600">date indisponibile</span>}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Cartonase</span>
                      <span className="font-semibold">{analysis.home_avg_cards !== null ? analysis.home_avg_cards.toFixed(1) : <span className="text-xs text-slate-600">date indisponibile</span>}</span>
                    </div>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-3">
                    <p className="text-xs text-slate-500 mb-2">{match.away_team_name}</p>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-slate-400">Cornere</span>
                      <span className="font-semibold">{analysis.away_avg_corners !== null ? analysis.away_avg_corners.toFixed(1) : <span className="text-xs text-slate-600">date indisponibile</span>}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Cartonase</span>
                      <span className="font-semibold">{analysis.away_avg_cards !== null ? analysis.away_avg_cards.toFixed(1) : <span className="text-xs text-slate-600">date indisponibile</span>}</span>
                    </div>
                  </div>
                </div>
              </>
            )}

            {analysis && ((analysis.home_injuries && analysis.home_injuries.length > 0) || (analysis.away_injuries && analysis.away_injuries.length > 0)) && (
              <>
                <h2 className="text-sm font-semibold text-slate-400 mb-3 uppercase tracking-wide">
                  Accidentari
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
                  <div>
                    <p className="text-xs text-slate-500 mb-2">{match.home_team_name}</p>
                    <div className="space-y-1">
                      {(analysis.home_injuries || []).length === 0 && <p className="text-xs text-slate-600">Fara raportari</p>}
                      {(analysis.home_injuries || []).map((inj, i) => (
                        <div key={i} className="text-xs bg-slate-900 border border-slate-800 rounded px-3 py-2">
                          <span className="text-slate-300">{inj.playerName}</span>
                          <span className="text-slate-500"> - {inj.reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-2">{match.away_team_name}</p>
                    <div className="space-y-1">
                      {(analysis.away_injuries || []).length === 0 && <p className="text-xs text-slate-600">Fara raportari</p>}
                      {(analysis.away_injuries || []).map((inj, i) => (
                        <div key={i} className="text-xs bg-slate-900 border border-slate-800 rounded px-3 py-2">
                          <span className="text-slate-300">{inj.playerName}</span>
                          <span className="text-slate-500"> - {inj.reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
