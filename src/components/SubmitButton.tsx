'use client';

import { useFormStatus } from 'react-dom';

interface SubmitButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  pendingText?: string;
  children: React.ReactNode;
}

export function SubmitButton({ children, pendingText, ...props }: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button {...props} type="submit" disabled={pending || props.disabled} className={`btn btn-primary ${props.className || ''}`} style={{ width: '100%', marginTop: '1rem' }}>
      {pending ? (pendingText || 'Submitting...') : children}
    </button>
  );
}
