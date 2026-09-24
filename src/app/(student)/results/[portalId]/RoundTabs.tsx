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
  deliveryMethod: 'online' | 'paper' | 'hybrid';
  state: 'scheduled' | 'open' | 'closed' | 'released' | 'archived';
  durationMinutes: number | null;
  sittingId: string | null;
  sittingStatus: 'active' | 'submitted' | 'abandoned' | null;
  myResult?: {
    submitted: boolean;
    score: number | null;
    // Total available marks for the round (sum of question marks); null when
    // the round has no questions in the bank, so no percentage is computable.
    maxScore: number | null;
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
          <button key={round.id} onClick={() => { setSelectedRoundId(round.id); setError(''); }} className={`px-4 py-2 font-semibold whitespace-nowrap transition-colors rounded-none ${selectedRoundId === round.id ? 'bg-blue-950 text-white' : 'text-slate-600 hover:bg-slate-100 border-b-2 border-transparent'}`}>
            {round.name}
          </button>
        ))}
      </div>
      
      <div className="bg-white p-6 md:p-8 rounded-sm border-2 border-slate-200 shadow-none">
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
            <span className={`inline-block px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-none ${hasResults ? 'bg-green-100 text-green-800 border border-green-200' : hasSubmitted ? 'bg-amber-100 text-amber-800 border border-amber-200' : selectedRound.sittingId ? 'bg-blue-100 text-blue-800 border border-blue-200' : canStart ? 'bg-blue-100 text-blue-800 border border-blue-200' : 'bg-slate-100 text-slate-600 border border-slate-200'}`}>
              {hasResults ? 'Graded' : hasSubmitted ? 'Submitted' : selectedRound.sittingId ? 'In progress' : canStart ? 'Ready' : closed ? 'Closed' : 'Not open'}
            </span>
            
            <div className="mt-4 flex md:justify-end">
              {hasResults ? (
                <Link
                  href={`/results/${portalId}/rounds/${selectedRound.id}/review`}
                  className="inline-block bg-blue-950 text-white font-bold px-5 py-2.5 rounded-sm hover:bg-blue-900 transition-colors"
                >
                  View Detailed Review
                </Link>
              ) : isOnlineOrHybrid ? (
                <button disabled={!canStart || starting} onClick={startOrResume} className="bg-blue-950 hover:bg-blue-900 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold px-8 py-3 rounded-none uppercase tracking-wider text-sm transition-colors">
                  {starting ? 'Opening…' : selectedRound.sittingId ? 'Resume test' : 'Start test'}
                </button>
              ) : (
                <button disabled className="bg-slate-200 text-slate-500 font-bold px-8 py-3 rounded-none uppercase tracking-wider text-sm cursor-not-allowed">
                  {hasSubmitted ? 'Submitted' : 'Paper Round'}
                </button>
              )}
            </div>
          </div>
        </div>

        {hasResults ? (
          <div className="mt-6 bg-slate-50 border-2 border-slate-200 rounded-sm p-6 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1.5 h-full bg-blue-950"></div>
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-2">Your Final Result</h3>
            <div className="flex items-baseline gap-3">
              <span className="text-4xl font-bold text-blue-950 leading-none">
                {selectedRound.myResult?.score ?? 0}
                {selectedRound.myResult?.maxScore
                  ? ` / ${selectedRound.myResult.maxScore}`
                  : ''}
              </span>
              {selectedRound.myResult?.maxScore ? (
                <span className="text-xl font-semibold text-slate-500">
                  {Math.round(
                    ((selectedRound.myResult.score ?? 0) /
                      selectedRound.myResult.maxScore) *
                      100
                  )}
                  %
                </span>
              ) : null}
            </div>
            {selectedRound.myResult?.feedback && (
              <div className="mt-6 p-4 bg-white border border-slate-200 rounded-sm text-slate-700">
                <strong className="text-blue-950 uppercase text-xs tracking-wider mb-1 block">Feedback</strong> 
                <p className="text-sm">{selectedRound.myResult?.feedback}</p>
              </div>
            )}
          </div>
        ) : hasSubmitted ? (
          <div className="mt-6 bg-slate-50 border-2 border-slate-200 rounded-sm p-6 text-center">
             <h3 className="text-xl font-bold text-blue-950">Awaiting Final Results</h3>
             <p className="text-slate-600 mt-2">Your results will appear here once the round is officially released.</p>
          </div>
        ) : null}

        {error && <div className="mt-5 bg-red-50 border border-red-200 text-red-800 p-3 rounded-md text-sm">{error}</div>}
      </div>
    </div>
  );
}