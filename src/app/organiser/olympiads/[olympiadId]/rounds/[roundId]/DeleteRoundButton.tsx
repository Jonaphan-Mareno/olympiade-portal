'use client';

import { useState } from 'react';
import { deleteRound } from './actions';

export default function DeleteRoundButton({ roundId, olympiadId }: { roundId: string, olympiadId: string }) {
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    if (window.confirm('Are you absolutely sure you want to delete this round? This action cannot be undone and will delete all associated questions, papers, and submissions.')) {
      setIsDeleting(true);
      try {
        await deleteRound(roundId, olympiadId);
      } catch (error) {
        console.error(error);
        alert('Failed to delete round.');
        setIsDeleting(false);
      }
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={isDeleting}
      className="bg-red-600 hover:bg-red-700 text-white font-semibold text-sm px-4 py-2 rounded-md transition-colors disabled:opacity-50"
    >
      {isDeleting ? 'Deleting...' : 'Delete Round'}
    </button>
  );
}
