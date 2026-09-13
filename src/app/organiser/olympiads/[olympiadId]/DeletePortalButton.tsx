'use client';

import { useTransition } from 'react';
import { deleteOlympiad } from './actions';

export default function DeletePortalButton({ portalId }: { portalId: string }) {
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    if (window.confirm("Are you sure you want to delete this Olympiad? This action cannot be undone and will delete all associated rounds and questions.")) {
      startTransition(() => {
        deleteOlympiad(portalId);
      });
    }
  };

  return (
    <button 
      onClick={handleDelete}
      disabled={isPending}
      className="bg-red-600 hover:bg-red-700 text-white font-medium px-6 py-2 rounded-md transition-colors"
    >
      {isPending ? 'Deleting...' : 'Delete Olympiad'}
    </button>
  );
}
