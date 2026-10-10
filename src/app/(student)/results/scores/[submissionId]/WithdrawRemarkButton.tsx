'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { withdrawStudentRemark } from './actions';

/** Withdraw a pending remark request, e.g. to fix a mistake in it. */
export default function WithdrawRemarkButton({
  submissionId,
  requestId,
  hasAttemptLeft,
}: {
  submissionId: string;
  requestId: string;
  hasAttemptLeft: boolean;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleWithdraw = async () => {
    setBusy(true);
    setError(null);
    const result = await withdrawStudentRemark(submissionId, requestId);
    setBusy(false);
    setConfirmOpen(false);
    if (!result.success) {
      setError(result.error || 'Could not withdraw the request.');
      return;
    }
    router.refresh();
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        className="text-sm font-bold text-red-700 hover:underline"
      >
        Withdraw request
      </button>
      <p className="text-xs text-slate-500 mt-1">
        Made a mistake? Withdraw this request before it is reviewed.
        {hasAttemptLeft
          ? ' You can then submit a corrected one.'
          : ' This was your last request, so you won’t be able to submit another.'}
      </p>
      {error && (
        <p className="text-sm text-red-700 font-bold mt-2" role="alert">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={confirmOpen}
        title="Withdraw your remark request?"
        description={
          hasAttemptLeft
            ? 'It still counts as one of your requests. You can then submit a corrected request.'
            : 'It still counts as one of your requests, and it is your last one, so you will not be able to request another remark for this paper.'
        }
        confirmLabel="Withdraw"
        busyLabel="Withdrawing…"
        busy={busy}
        onConfirm={handleWithdraw}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
