'use client';

import { useState } from 'react';
import { Spinner } from './Spinner';

// A button that cannot be double-fired: once its onClick promise starts, the
// button disables itself, shows a spinner, and ignores further clicks until
// the promise settles. Use for one-shot actions like sign-out that are not
// part of a <form> (for forms, prefer SubmitButton, which reads useFormStatus).
type PendingButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => unknown;
  // Text shown while the handler runs; defaults to the button's children.
  pendingText?: React.ReactNode;
  // External pending state (e.g. a useTransition) merged with the internal one.
  pending?: boolean;
};

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === 'function'
  );
}

export function PendingButton({
  onClick,
  pendingText,
  pending = false,
  children,
  disabled,
  className,
  ...props
}: PendingButtonProps) {
  const [busy, setBusy] = useState(false);
  const isPending = busy || pending;

  async function handleClick(event: React.MouseEvent<HTMLButtonElement>) {
    if (disabled || isPending) return; // double-click / disabled guard
    const result = onClick?.(event);
    if (isPromiseLike(result)) {
      setBusy(true);
      try {
        await result;
      } finally {
        setBusy(false);
      }
    }
  }

  return (
    <button
      {...props}
      onClick={handleClick}
      disabled={disabled || isPending}
      aria-busy={isPending}
      className={`inline-flex items-center gap-2 ${className || ''}`}
    >
      {isPending ? (
        <>
          <Spinner /> {pendingText ?? children}
        </>
      ) : (
        children
      )}
    </button>
  );
}
