'use client';

import { useState, useTransition } from 'react';
import type { SimulationResult } from './dry-run';
import { formatSAST } from '@/lib/sast';

type RoundOption = { id: string; name: string };

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  due: {
    label: 'Due now',
    className: 'bg-amber-100 text-amber-900 border-amber-300',
  },
  waiting: {
    label: 'Scheduled',
    className: 'bg-blue-100 text-blue-900 border-blue-300',
  },
  missed: {
    label: 'Will not send',
    className: 'bg-slate-100 text-slate-700 border-slate-300',
  },
  not_applicable: {
    label: 'Does not apply',
    className: 'bg-slate-100 text-slate-700 border-slate-300',
  },
};

/**
 * Lets the organiser pick a round and see exactly what a rule would do to
 * it — when it fires, who it reaches and the email they get — without
 * sending anything.
 */
export default function SimulationPanel({
  rounds,
  run,
}: {
  rounds: RoundOption[];
  run: (roundId: string) => Promise<SimulationResult>;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [roundId, setRoundId] = useState(rounds[0]?.id ?? '');

  if (rounds.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Create a round first to try this rule against it.
      </p>
    );
  }

  const handleRun = () => {
    if (!roundId) return;
    setResult(null);
    startTransition(async () => {
      setResult(await run(roundId));
    });
  };

  return (
    <div className="p-4 bg-blue-50 border border-blue-200 rounded-md text-slate-900">
      <div className="flex flex-col sm:flex-row gap-3">
        <select
          value={roundId}
          onChange={(e) => setRoundId(e.target.value)}
          className="flex-1 p-2 border border-slate-300 rounded text-sm bg-white text-slate-900"
        >
          {rounds.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleRun}
          disabled={isPending}
          className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold rounded disabled:bg-blue-300"
        >
          {isPending ? 'Running…' : 'Run dry run'}
        </button>
      </div>

      {result && 'error' in result && (
        <div className="mt-4 text-sm text-red-700 font-semibold">
          {result.error}
        </div>
      )}

      {result && !('error' in result) && (
        <div className="mt-4 bg-white border border-slate-200 rounded p-4 text-sm space-y-4">
          <div>
            <div className="font-bold text-slate-900">
              “{result.ruleName}” on {result.roundName}
            </div>
            <div className="text-slate-600">
              {result.triggerLabel} · {result.schedule}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`px-2 py-0.5 text-xs font-bold border rounded ${STATUS_STYLES[result.timing.status].className}`}
            >
              {STATUS_STYLES[result.timing.status].label}
            </span>
            <span className="text-slate-700">
              {result.timing.fireAt && (
                <>Send time: {formatSAST(result.timing.fireAt, { dateStyle: 'medium', timeStyle: 'short' })}. </>
              )}
              {result.timing.reason}
            </span>
          </div>

          <div>
            <div className="font-semibold text-slate-900 mb-2">
              {result.recipients.length === 0
                ? 'No one matches this rule for this round right now.'
                : `${result.recipients.length} recipient${result.recipients.length === 1 ? '' : 's'} match right now`}
            </div>
            {result.recipients.length > 0 && (
              <div className="max-h-48 overflow-auto border border-slate-200 rounded">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Email</th>
                      <th className="px-3 py-2 font-semibold">School</th>
                      <th className="px-3 py-2 font-semibold">Gets</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-800">
                    {result.recipients.map((r, i) => (
                      <tr key={`${r.email}-${i}`}>
                        <td className="px-3 py-1.5 break-all">{r.email}</td>
                        <td className="px-3 py-1.5">{r.schoolName ?? '—'}</td>
                        <td className="px-3 py-1.5">
                          {r.audience === 'school' ? 'School email' : 'Own result'}
                        </td>
                        <td className="px-3 py-1.5">
                          {r.alreadySent ? 'Already sent' : 'Would send'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {result.sample && (
            <div className="border border-slate-200 rounded overflow-hidden">
              <div className="bg-slate-100 px-3 py-2 border-b border-slate-200 text-xs text-slate-700">
                <div>
                  <strong>To:</strong> {result.sample.to}
                </div>
                <div>
                  <strong>Subject:</strong> {result.sample.subject}
                </div>
              </div>
              <iframe
                title="Email preview"
                srcDoc={result.sample.html}
                sandbox=""
                className="w-full h-80 bg-white"
              />
            </div>
          )}

          <p className="text-xs text-slate-500">
            This was a dry run — nothing was sent.
          </p>
        </div>
      )}
    </div>
  );
}
