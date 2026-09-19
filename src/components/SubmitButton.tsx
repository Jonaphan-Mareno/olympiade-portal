'use client';

import { useFormStatus } from 'react-dom';
import { Spinner } from '@/components/ui/Spinner';

interface SubmitButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  pendingText?: string;
  children: React.ReactNode;
  // When false, the button keeps its natural size instead of stretching
  // full-width (used by form pages with their own button styling).
  fullWidth?: boolean;
}

// Submit button for <form action={...}> that cannot be double-fired: while
// the form submission is in flight it disables itself and shows a spinner
// (via useFormStatus). Pass a className for custom styling; without one the
// auth-page defaults (btn btn-primary, full width) apply.
export function SubmitButton({
  children,
  pendingText,
  fullWidth = true,
  className,
  style,
  ...props
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      {...props}
      type="submit"
      disabled={pending || props.disabled}
      aria-busy={pending}
      className={
        className ||
        'btn btn-primary inline-flex items-center justify-center gap-2'
      }
      style={style ?? (fullWidth ? { width: '100%', marginTop: '1rem' } : undefined)}
    >
      {pending ? (
        <>
          <Spinner /> {pendingText || 'Submitting...'}
        </>
      ) : (
        children
      )}
    </button>
  );
}
