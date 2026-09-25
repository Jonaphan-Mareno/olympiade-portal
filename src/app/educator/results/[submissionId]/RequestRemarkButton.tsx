'use client';

import { useState } from 'react';
import { requestRemark } from './actions';

export default function RequestRemarkButton({ submissionId }: { submissionId: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError('Please provide a reason for the remark request.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    const result = await requestRemark(submissionId, reason);
    setIsSubmitting(false);

    if (result.success) {
      setIsOpen(false);
    } else {
      setError(result.error || 'Failed to submit request');
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="px-4 py-2 border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 font-medium rounded-md text-sm transition-colors"
      >
        Request Remark
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200">
              <h3 className="text-lg font-bold text-slate-900 font-serif">Request a Remark</h3>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6">
              <p className="text-sm text-slate-600 mb-4">
                If you believe there was an error in marking, you can request a remark. 
                Please provide specific details about which questions need review and why.
              </p>
              
              <div className="mb-4">
                <label htmlFor="reason" className="block text-sm font-semibold text-slate-700 mb-1">
                  Reason for Request <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="reason"
                  rows={4}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="E.g., Question 4 was marked incorrect but the student's answer matches the memo..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-md border border-red-200">
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  disabled={isSubmitting}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
