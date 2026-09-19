'use client';

import { useEffect, useRef } from 'react';
import { Spinner } from './Spinner';

// Accessible confirmation modal for irreversible actions (publish results,
// delete olympiad, submit exam attempt). Controlled by the parent: render
// <ConfirmDialog open={...} /> and close it from onConfirm/onCancel once the
// action settles. While `busy` is true the dialog cannot be dismissed, so a
// confirmed action always runs to completion visibly.
type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  // danger renders the confirm button in red for destructive actions.
  tone?: 'primary' | 'danger';
  // True while the confirmed action is running: shows a spinner and locks
  // every dismissal route (backdrop, Escape, Cancel).
  busy?: boolean;
  busyLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  busy = false,
  busyLabel = 'Working…',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Focus the safe option on open and lock background scrolling.
  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault();
      onCancel();
      return;
    }
    // Minimal focus trap: the dialog has exactly two buttons, so Tab and
    // Shift+Tab simply toggle between them (which also handles wrapping).
    if (event.key === 'Tab') {
      event.preventDefault();
      const fromCancel = document.activeElement === cancelRef.current;
      (fromCancel ? confirmRef.current : cancelRef.current)?.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        onClick={busy ? undefined : onCancel}
        aria-hidden="true"
        data-testid="dialog-backdrop"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onKeyDown={onKeyDown}
        className="relative bg-white rounded-xl shadow-2xl max-w-md w-full p-6"
      >
        <h2
          id="confirm-dialog-title"
          className="text-lg font-bold text-slate-900"
        >
          {title}
        </h2>
        {description && (
          <div className="mt-2 text-sm text-slate-600 leading-relaxed">
            {description}
          </div>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-md transition-colors disabled:opacity-70 disabled:cursor-not-allowed ${
              tone === 'danger'
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-blue-900 hover:bg-blue-800'
            }`}
          >
            {busy ? (
              <>
                <Spinner /> {busyLabel}
              </>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
