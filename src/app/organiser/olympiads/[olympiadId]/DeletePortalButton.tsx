'use client';

import { useState, useTransition } from 'react';
import { deleteOlympiad } from './actions';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

export default function DeletePortalButton({ portalId }: { portalId: string }) {
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleDelete = () => {
    startTransition(async () => {
      try {
        await deleteOlympiad(portalId);
      } catch {
        // deleteOlympiad redirects, which throws on the client — the router
        // still performs the navigation, so there is nothing to recover from.
      }
      setConfirmOpen(false);
    });
  };

  return (
    <>
      <button
        onClick={() => setConfirmOpen(true)}
        disabled={isPending}
        className="bg-red-600 hover:bg-red-700 disabled:bg-slate-400 disabled:cursor-not-allowed text-white font-medium px-6 py-2 rounded-md transition-colors"
      >
        {isPending ? 'Deleting...' : 'Delete Olympiad'}
      </button>

      <ConfirmDialog
        open={confirmOpen}
        title="Delete this Olympiad?"
        description={
          <>
            This action cannot be undone and will delete all associated
            rounds and questions.
          </>
        }
        confirmLabel="Delete Olympiad"
        tone="danger"
        busyLabel="Deleting…"
        busy={isPending}
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
