'use client';

import { useState, useTransition } from 'react';
import { runDryRun, type DryRunResult } from './dry-run';

export default function DryRunButton({ ruleId, rounds }: { ruleId: string, rounds: { id: string, name: string }[] }) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<DryRunResult | null>(null);
  const [selectedRound, setSelectedRound] = useState(rounds[0]?.id || '');
  const [isOpen, setIsOpen] = useState(false);

  if (rounds.length === 0) {
    return <span className="text-xs text-slate-400">No rounds available to test against</span>;
  }

  const handleRun = () => {
    if (!selectedRound) return;
    setResult(null);
    startTransition(async () => {
      const res = await runDryRun(ruleId, selectedRound);
      setResult(res);
    });
  };

  return (
    <div>
      <button 
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="text-blue-600 hover:text-blue-800 text-sm font-semibold"
      >
        Try against a round
      </button>

      {isOpen && (
        <div className="mt-3 p-4 bg-blue-50 border border-blue-200 rounded-md">
          <div className="flex gap-3 mb-4">
            <select 
              value={selectedRound} 
              onChange={e => setSelectedRound(e.target.value)}
              className="flex-1 p-2 border border-slate-300 rounded text-sm bg-white"
            >
              {rounds.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <button
              onClick={handleRun}
              disabled={isPending}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded disabled:bg-blue-300"
            >
              {isPending ? 'Simulating...' : 'Run Simulation'}
            </button>
          </div>

          {result && (
            <div className="bg-white p-4 border border-slate-200 rounded text-sm">
              {result.error ? (
                <div className="text-red-600 font-bold">Error: {result.error}</div>
              ) : (
                <>
                  <div className="font-bold text-slate-800 mb-2">
                    Simulation Results for "{result.ruleName}"
                  </div>
                  <div className="mb-4 text-green-700 font-semibold">
                    ✅ This rule would target {result.matchedRecipients} recipient{result.matchedRecipients === 1 ? '' : 's'}.
                  </div>
                  {result.sampleEmail && (
                    <div className="border border-slate-200 rounded">
                      <div className="bg-slate-100 p-2 border-b border-slate-200 text-xs text-slate-500 font-mono">
                        <div><strong>To:</strong> {result.sampleEmail.to}</div>
                        <div><strong>Subject:</strong> {result.sampleEmail.subject}</div>
                      </div>
                      <div className="p-4 prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: result.sampleEmail.html }} />
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
