'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Round = {
  id: string; name: string; opensAt: Date | null; closesAt: Date | null; qualifyingThreshold: string | null;
  deliveryMethod: 'online' | 'paper'; durationMinutes: number | null; sittingId: string | null;
  sittingStatus: 'active' | 'submitted' | 'abandoned' | null; resultId: string | null;
  resultStatus: 'auto_marked' | 'queued_for_marker' | 'moderated' | 'remark_requested' | null; resultScore: string | null;
};

export default function RoundTabs({ rounds, portalId }: { rounds: Round[]; portalId: string }) {
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(rounds[0]?.id ?? null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  if (!rounds.length) return <p className="text-slate-500 italic mt-8">There are currently no rounds available for this Olympiad.</p>;
  const selectedRound = rounds.find((r) => r.id === selectedRoundId)!;
  const now = new Date();
  const opened = selectedRound.opensAt ? now >= new Date(selectedRound.opensAt) : false;
  const closed = selectedRound.closesAt ? now > new Date(selectedRound.closesAt) : false;
  const canStart = selectedRound.deliveryMethod === 'online' && opened && !closed && selectedRound.sittingStatus !== 'submitted' && !selectedRound.resultId;

  async function startOrResume() {
    setStarting(true); setError('');
    try {
      if (selectedRound.sittingId) return router.push(`/sitting/${selectedRound.sittingId}`);
      const res = await fetch('/api/student/sitting/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roundId: selectedRound.id }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to start test');
      router.push(`/sitting/${data.sittingId}`);
    } catch (e: any) { setError(e.message); setStarting(false); }
  }

  return <div className="mt-8"><div className="flex gap-3 border-b border-slate-200 pb-2 overflow-x-auto mb-5">{rounds.map((round) => <button key={round.id} onClick={() => { setSelectedRoundId(round.id); setError(''); }} className={`px-4 py-2 rounded-md font-semibold whitespace-nowrap ${selectedRoundId === round.id ? 'bg-blue-700 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{round.name}</button>)}</div><div className="bg-white p-6 md:p-8 rounded-xl border border-slate-200 shadow-sm"><div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6"><div><p className="text-xs font-bold text-blue-700 uppercase tracking-wide">{selectedRound.deliveryMethod === 'online' ? 'Online test' : 'Paper round'}</p><h2 className="text-2xl font-bold text-slate-900 mt-1">{selectedRound.name}</h2><p className="text-slate-600 mt-2">Opens: {selectedRound.opensAt ? new Date(selectedRound.opensAt).toLocaleString() : 'Not set'}</p><p className="text-slate-600">Closes: {selectedRound.closesAt ? new Date(selectedRound.closesAt).toLocaleString() : 'Not set'}</p>{selectedRound.deliveryMethod === 'online' && <p className="text-slate-600">Time limit: {selectedRound.durationMinutes ?? 60} minutes</p>}</div>{selectedRound.deliveryMethod === 'online' && <div className="md:text-right"><span className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${selectedRound.resultStatus === 'moderated' ? 'bg-green-100 text-green-700' : selectedRound.resultStatus === 'remark_requested' ? 'bg-amber-100 text-amber-700' : selectedRound.resultStatus === 'queued_for_marker' ? 'bg-amber-100 text-amber-700' : selectedRound.sittingId ? 'bg-amber-100 text-amber-700' : canStart ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>{selectedRound.resultStatus === 'moderated' ? 'Reviewed' : selectedRound.resultStatus === 'remark_requested' ? 'Remark requested' : selectedRound.resultStatus === 'queued_for_marker' ? 'Awaiting marking' : selectedRound.sittingStatus === 'submitted' ? 'Submitted' : selectedRound.sittingId ? 'In progress' : canStart ? 'Ready' : closed ? 'Closed' : 'Not open'}</span><div className="mt-3">{selectedRound.resultId ? <button onClick={() => router.push(`/results/${portalId}/round/${selectedRound.id}`)} className="bg-blue-700 hover:bg-blue-800 text-white font-semibold px-5 py-2.5 rounded-md">Review results</button> : <button disabled={!canStart || starting} onClick={startOrResume} className="bg-blue-700 hover:bg-blue-800 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold px-5 py-2.5 rounded-md">{starting ? 'Opening…' : selectedRound.sittingId ? 'Resume test' : 'Start test'}</button>}</div></div>}</div>{selectedRound.resultId && <p className="mt-5 text-sm text-slate-600">Your result is {selectedRound.resultStatus === 'moderated' ? 'reviewed and available.' : selectedRound.resultStatus === 'remark_requested' ? 'under remark review.' : 'partially marked while manual marking is completed.'}</p>}{error && <div className="mt-5 bg-red-50 border border-red-200 text-red-800 p-3 rounded-md text-sm">{error}</div>}</div></div>;
}
