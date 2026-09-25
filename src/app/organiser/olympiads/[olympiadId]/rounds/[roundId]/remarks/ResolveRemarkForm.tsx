'use client';

import { useState } from 'react';
import { resolveRemark } from './actions';

export default function ResolveRemarkForm({ resultId }: { resultId: string }) {
  const [outcome, setOutcome] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!outcome.trim()) {
      setError('Please provide an outcome.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    const result = await resolveRemark(resultId, outcome);
    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error || 'Failed to resolve remark');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
      <div>
        <label htmlFor={`outcome-${resultId}`} className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
          Resolution Outcome
        </label>
        <textarea
          id={`outcome-${resultId}`}
          rows={3}
          className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
          placeholder="E.g., Adjusted score to +2 marks because the student used an alternative method..."
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          disabled={isSubmitting}
        />
      </div>

      {error && (
        <div className="p-2 bg-red-50 text-red-700 text-xs rounded border border-red-200">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Resolving...' : 'Mark as Resolved'}
        </button>
      </div>
    </form>
  );
}
