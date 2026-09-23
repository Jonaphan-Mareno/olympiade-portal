'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { addEducators } from './actions';
import { Spinner } from '@/components/ui/Spinner';

// Opens a dialog for inviting more educators to a school that already
// participates in the olympiad — without it, a school's educator list was
// frozen at the moment the school was added.
export default function AddEducatorButton({
  portalId,
  schoolId,
  schoolName,
}: {
  portalId: string;
  schoolId: string;
  schoolName: string;
}) {
  const [open, setOpen] = useState(false);
  const [emails, setEmails] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const emailInputRef = useRef<HTMLInputElement>(null);

  // Focus the email input on open and lock background scrolling, like
  // ConfirmDialog.
  useEffect(() => {
    if (!open) return;
    emailInputRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  function close() {
    if (isPending) return;
    setOpen(false);
    setEmails([]);
    setNewEmail('');
    setError(null);
  }

  function addEmail() {
    const email = newEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    if (!emails.includes(email)) {
      setEmails((prev) => [...prev, email]);
    }
    setNewEmail('');
  }

  function removeEmail(email: string) {
    setEmails((prev) => prev.filter((e) => e !== email));
  }

  function handleSubmit(formData: FormData) {
    setError(null);
    for (const email of emails) {
      formData.append('teacherEmails', email);
    }

    startTransition(async () => {
      const result = await addEducators(portalId, schoolId, formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setOpen(false);
        setEmails([]);
        setNewEmail('');
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap"
      >
        + Add Educator
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            onClick={close}
            aria-hidden="true"
            data-testid="dialog-backdrop"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-educator-title"
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !isPending) {
                e.preventDefault();
                close();
              }
            }}
            className="relative bg-white rounded-xl shadow-2xl max-w-md w-full p-6"
          >
            <h2
              id="add-educator-title"
              className="text-lg font-bold text-slate-900"
            >
              Add educators to {schoolName}
            </h2>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              Each educator receives an email invite to join this school in your
              olympiad. Emails already invited or accepted are skipped.
            </p>

            {error && (
              <div className="mt-3 bg-red-50 text-red-900 p-3 rounded-md border border-red-100 text-sm font-medium">
                {error}
              </div>
            )}

            <form action={handleSubmit} className="mt-4">
              {emails.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {emails.map((email) => (
                    <span
                      key={email}
                      className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded-md"
                    >
                      {email}
                      <button
                        type="button"
                        onClick={() => removeEmail(email)}
                        disabled={isPending}
                        aria-label={`Remove ${email}`}
                        className="hover:bg-blue-200 rounded-full p-0.5 transition-colors flex items-center justify-center outline-none"
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <input
                  ref={emailInputRef}
                  type="email"
                  value={newEmail}
                  disabled={isPending}
                  onChange={(e) => setNewEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addEmail();
                    }
                  }}
                  placeholder="educator@school.edu"
                  className="flex-1 border border-slate-300 rounded-md p-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white disabled:bg-slate-50"
                />
                <button
                  type="button"
                  onClick={addEmail}
                  disabled={isPending}
                  className="bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
                >
                  Add
                </button>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={close}
                  disabled={isPending}
                  className="px-4 py-2 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending || emails.length === 0}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-900 hover:bg-blue-800 rounded-md transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isPending ? (
                    <>
                      <Spinner /> Sending…
                    </>
                  ) : (
                    'Send Invitations'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
