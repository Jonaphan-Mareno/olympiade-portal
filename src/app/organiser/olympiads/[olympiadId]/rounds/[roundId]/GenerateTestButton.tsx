'use client';

import { useTransition } from 'react';
import { generateTestFromPDF } from './ai-actions';

export default function GenerateTestButton({ roundId, olympiadId }: { roundId: string, olympiadId: string }) {
  const [isPending, startTransition] = useTransition();

  function handleGenerate() {
    startTransition(async () => {
      try {
        await generateTestFromPDF(roundId, olympiadId);
      } catch (err: any) {
        console.error(err);
        alert(err.message || 'Failed to generate test.');
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleGenerate}
      disabled={isPending}
      className="mt-4 flex items-center justify-center w-full px-6 py-4 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-bold rounded-lg shadow-md transition-all disabled:opacity-70 disabled:cursor-not-allowed"
    >
      {isPending ? (
        <span className="flex items-center gap-2">
          <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Generating Online Test via AI... This may take up to 30 seconds.
        </span>
      ) : (
        <span className="flex items-center gap-2">
          ✨ Generate Online Test from PDF
        </span>
      )}
    </button>
  );
}
