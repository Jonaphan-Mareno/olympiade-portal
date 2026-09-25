'use client';

import { useState, useTransition } from 'react';
import { publishRoundResults } from './actions';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

type AdvancementSummary = {
  advancedCount: number;
  skippedAlreadyEnrolled: number;
  nextRoundId: string | null;
  nextRoundName: string | null;
  noNextRound: boolean;
  noThresholdSet: boolean;
};

type PublishOutcome = {
  error?: string;
  alreadyPublished?: boolean;
  summary?: { sent: number; skipped: number; failed: number };
  advancementSummary?: AdvancementSummary | null;
};

export default function PublishResultsButton({
  portalId,
  roundId,
}: {
  portalId: string;
  roundId: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<PublishOutcome | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handlePublish = () => {
    const formData = new FormData();
    formData.set('portalId', portalId);
    formData.set('roundId', roundId);

    startTransition(async () => {
      const result = await publishRoundResults(formData);
      setOutcome(result as PublishOutcome);
      setConfirmOpen(false);
    });
  };

  return (
    <div>
      <button
        onClick={() => setConfirmOpen(true)}
        disabled={isPending}
        className="bg-green-700 hover:bg-green-800 disabled:bg-slate-400 disabled:cursor-not-allowed text-white font-medium px-6 py-2 rounded-md transition-colors"
      >
        {isPending ? 'Publishing & advancing…' : 'Publish Results'}
      </button>

      <ConfirmDialog
        open={confirmOpen}
        title="Publish results for this round?"
        description={
          <>
            Educators will receive a school-level summary and every entrant who
            submitted will be emailed their own result. Qualifying students will
            be automatically advanced to the next round.{' '}
            <strong>This cannot be undone.</strong>
          </>
        }
        confirmLabel="Publish Results"
        busyLabel="Publishing & advancing…"
        busy={isPending}
        onConfirm={handlePublish}
        onCancel={() => setConfirmOpen(false)}
      />

      {outcome?.error && (
        <p className="text-sm text-red-700 mt-2" role="alert">
          {outcome.error}
        </p>
      )}

      {outcome?.alreadyPublished && (
        <p className="text-sm text-slate-600 mt-2">
          Results for this round have already been published.
        </p>
      )}

      {outcome?.summary && (
        <p
          className="text-sm text-green-800 mt-2"
          data-testid="publish-summary"
        >
          Results published — {outcome.summary.sent} email
          {outcome.summary.sent === 1 ? '' : 's'} sent
          {outcome.summary.failed > 0
            ? `, ${outcome.summary.failed} failed (will be retried by the daily sweep)`
            : ''}
          .
        </p>
      )}

      {outcome?.advancementSummary && !outcome.advancementSummary.noThresholdSet && (
        <div className="mt-3 p-3 rounded-md border text-sm
          bg-blue-50 border-blue-200 text-blue-800">
          {outcome.advancementSummary.noNextRound ? (
            <p>ℹ️ This is the final round — no advancement was performed.</p>
          ) : outcome.advancementSummary.advancedCount === 0 ? (
            <p>
              No students met the advancement criteria for{' '}
              <strong>{outcome.advancementSummary.nextRoundName}</strong>.
            </p>
          ) : (
            <p>
              ✅ <strong>{outcome.advancementSummary.advancedCount}</strong> student
              {outcome.advancementSummary.advancedCount === 1 ? '' : 's'} automatically
              advanced to <strong>{outcome.advancementSummary.nextRoundName}</strong>.
              {outcome.advancementSummary.skippedAlreadyEnrolled > 0 &&
                ` (${outcome.advancementSummary.skippedAlreadyEnrolled} were already enrolled.)`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
