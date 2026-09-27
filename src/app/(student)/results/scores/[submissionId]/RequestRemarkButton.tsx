'use client';

import { useState } from 'react';
import { requestStudentRemark } from './actions';

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
    const result = await requestStudentRemark(submissionId, reason);
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
        className="px-6 py-3 bg-amber-400 hover:bg-amber-500 text-amber-950 font-bold uppercase tracking-wider text-sm transition-colors"
      >
        Request Remark
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-none border-2 border-slate-200 shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b-2 border-slate-200 bg-slate-50">
              <h3 className="text-lg font-bold text-blue-950 font-serif">Request a Remark</h3>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6">
              <p className="text-sm text-slate-600 mb-6 font-medium">
                If you believe there was an error in marking, you can request a remark. 
                Please provide specific details about which questions need review and why.
              </p>
              
              <div className="mb-6">
                <label htmlFor="reason" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Reason for Request <span className="text-amber-500">*</span>
                </label>
                <textarea
                  id="reason"
                  rows={4}
                  className="w-full px-4 py-3 border-2 border-slate-200 rounded-none focus:outline-none focus:border-blue-950"
                  placeholder="E.g., Question 4 was marked incorrect but my answer matches the memo..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>

              {error && (
                <div className="mb-6 p-3 bg-red-50 text-red-700 text-sm font-bold border-l-4 border-red-500">
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-4 pt-4">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  disabled={isSubmitting}
                  className="px-6 py-3 text-sm font-bold text-slate-700 uppercase tracking-wider hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-6 py-3 text-sm font-bold text-white uppercase tracking-wider bg-blue-950 hover:bg-blue-900 transition-colors disabled:opacity-50"
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
