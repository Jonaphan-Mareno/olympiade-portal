'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';

type Round = {
  id: string;
  name: string;
  opensAt: Date | string | null;
  closesAt: Date | string | null;
  qualifyingThreshold: string | null;
  deliveryMethod: 'online' | 'paper';
  durationMinutes: number | null;
  sittingId: string | null;
  sittingStatus: 'active' | 'submitted' | 'abandoned' | null;
  myResult?: {
    submitted: boolean;
    score: number | null;
    feedback: string | null;
  } | null;
};

export default function RoundTabs({ rounds }: { rounds: Round[] }) {
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(rounds[0]?.id ?? null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  
  const router = useRouter();
  const params = useParams();
  const portalId = params.portalId as string;

  if (!rounds.length) return <p className="text-slate-500 italic mt-8">There are currently no rounds available for this Olympiad.</p>;
  
  const selectedRound = rounds.find((r) => r.id === selectedRoundId)!;
  const now = new Date();
  const opened = selectedRound.opensAt ? now >= new Date(selectedRound.opensAt) : false;
  const closed = selectedRound.closesAt ? now > new Date(selectedRound.closesAt) : false;
  
  // Results logic
  const isReleased = selectedRound.state === 'released';
  const hasResults = isReleased && selectedRound.myResult && selectedRound.myResult.score !== null;
  const hasSubmitted = selectedRound.sittingStatus === 'submitted' || selectedRound.myResult?.submitted;
  
  const isOnlineOrHybrid = selectedRound.deliveryMethod === 'online' || selectedRound.deliveryMethod === 'hybrid';
  const canStart = isOnlineOrHybrid && opened && !closed && !hasSubmitted;

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

  // Force a consistent format for both the server and the client
const formatDateTime = (dateString: Date | string) => {
  return new Intl.DateTimeFormat('en-ZA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(dateString));
};

  return (
    <div className="mt-8">
      
      <div className="flex gap-3 border-b border-slate-200 pb-2 overflow-x-auto mb-5">
        {rounds.map((round) => (
          <button key={round.id} onClick={() => { setSelectedRoundId(round.id); setError(''); }} className={`px-4 py-2 rounded-md font-semibold whitespace-nowrap ${selectedRoundId === round.id ? 'bg-blue-700 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
            {round.name}
          </button>
        ))}
      </div>
      
      <div className="bg-white p-6 md:p-8 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
          <div>
            <p className="text-xs font-bold text-blue-700 uppercase tracking-wide">{selectedRound.deliveryMethod === 'online' ? 'Online test' : selectedRound.deliveryMethod === 'paper' ? 'Paper round' : 'Hybrid round'}</p>
            <h2 className="text-2xl font-bold text-slate-900 mt-1">{selectedRound.name}</h2>
            <p className="text-slate-600 mt-2" suppressHydrationWarning>
              Opens: {selectedRound.opensAt ? formatDateTime(selectedRound.opensAt) : 'Not set'}
            </p>
            <p className="text-slate-600" suppressHydrationWarning>
              Closes: {selectedRound.closesAt ? formatDateTime(selectedRound.closesAt) : 'Not set'}
            </p>
          </div>
          
          <div className="md:text-right">
            <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${hasResults ? 'bg-green-100 text-green-700' : hasSubmitted ? 'bg-amber-100 text-amber-700' : selectedRound.sittingId ? 'bg-blue-100 text-blue-700' : canStart ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
              {hasResults ? 'Graded' : hasSubmitted ? 'Submitted' : selectedRound.sittingId ? 'In progress' : canStart ? 'Ready' : closed ? 'Closed' : 'Not open'}
            </span>
            
            <div className="mt-4">
              {hasResults ? (
                <Link
                  href={`/results/${portalId}/rounds/${selectedRound.id}/review`}
                  className="inline-block bg-blue-700 text-white font-semibold px-5 py-2.5 rounded-md hover:bg-blue-800"
                >
                  View Detailed Review
                </Link>
              ) : isOnlineOrHybrid ? (
                <button disabled={!canStart || starting} onClick={startOrResume} className="bg-blue-700 hover:bg-blue-800 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold px-5 py-2.5 rounded-md">
                  {starting ? 'Opening…' : selectedRound.sittingId ? 'Resume test' : 'Start test'}
                </button>
              ) : (
                <button disabled className="bg-slate-300 text-white font-semibold px-5 py-2.5 rounded-md cursor-not-allowed">
                  {hasSubmitted ? 'Submitted' : 'Paper Round'}
                </button>
              )}
            </div>
          </div>
        </div>

        {hasResults ? (
          <div className="mt-6 bg-slate-50 border border-slate-200 rounded-lg p-5">
            <h3 className="text-sm font-semibold text-slate-500 uppercase mb-2">Your Final Result</h3>
            <div className="flex items-end gap-2">
              <span className="text-4xl font-bold text-blue-700 leading-none">{selectedRound.myResult?.score}</span>
            </div>
            {selectedRound.myResult?.feedback && (
              <div className="mt-4 p-4 bg-white border border-slate-200 rounded text-slate-700 text-sm">
                <strong>Feedback:</strong> {selectedRound.myResult?.feedback}
              </div>
            )}
          </div>
        ) : hasSubmitted ? (
          <div className="mt-6 bg-slate-50 border border-slate-200 rounded-lg p-5 text-center">
             <h3 className="text-lg font-bold text-slate-900">Awaiting Final Results</h3>
             <p className="text-slate-600 mt-1">Your results will appear here once the round is officially released.</p>
          </div>
        ) : null}

        {error && <div className="mt-5 bg-red-50 border border-red-200 text-red-800 p-3 rounded-md text-sm">{error}</div>}
      </div>
    </div>
  );
}