'use client';

import { useState, useTransition } from 'react';
import { publishRoundResults } from './actions';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

type PublishOutcome = {
  error?: string;
  alreadyPublished?: boolean;
  summary?: { sent: number; skipped: number; failed: number };
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
      setOutcome(result);
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
        {isPending ? 'Publishing & emailing…' : 'Publish Results'}
      </button>

      <ConfirmDialog
        open={confirmOpen}
        title="Publish results for this round?"
        description={
          <>
            Educators will receive a school-level summary and every entrant who
            submitted will be emailed their own result.{' '}
            <strong>This cannot be undone.</strong>
          </>
        }
        confirmLabel="Publish Results"
        busyLabel="Publishing & emailing…"
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
    </div>
  );
}
