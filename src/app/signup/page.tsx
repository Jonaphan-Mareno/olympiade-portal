'use client';

import { useState, Suspense } from 'react';
import { signup } from '@/app/auth/actions';
import { SubmitButton } from '@/components/SubmitButton';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

function SignupForm() {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get('inviteToken') || searchParams.get('token');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setError(null);
    const result = await signup(formData);
    if (result?.error) {
      setError(result.error);
    }
  }

  return (
    <div className="auth-wrapper">
      <div className="bg-blob blob-1"></div>
      <div className="bg-blob blob-2"></div>
      
      <div className="glass-panel auth-form-container">
        <div className="auth-header">
          <h1 className="auth-title">
            {inviteToken ? 'Claim Your Account' : 'Create Account'}
          </h1>
          <p className="auth-subtitle">
            {inviteToken 
              ? 'You have been invited to join an Olympiad.' 
              : 'Register to organise a new Olympiad.'}
          </p>
        </div>

        <form action={handleSubmit}>
          {error && <div className="form-error">{error}</div>}
          
          {/* Hidden input to pass the invite token to the server action */}
          {inviteToken && (
            <input type="hidden" name="inviteToken" value={inviteToken} />
          )}

          <div className="input-group">
            <input 
              className="input-field" 
              type="text" 
              name="name" 
              id="name" 
              placeholder=" " 
              required 
            />
            <label className="input-label" htmlFor="name">Full Name</label>
          </div>

          <div className="input-group">
            <input 
              className="input-field" 
              type="email" 
              name="email" 
              id="email" 
              placeholder=" " 
              required 
            />
            <label className="input-label" htmlFor="email">Email Address</label>
          </div>

          <div className="input-group">
            <input 
              className="input-field" 
              type="password" 
              name="password" 
              id="password" 
              placeholder=" " 
              required 
              minLength={6}
            />
            <label className="input-label" htmlFor="password">Password (min 6 characters)</label>
          </div>

          <SubmitButton pendingText="Creating Account...">
            {inviteToken ? 'Claim Account' : 'Sign Up as Organiser'}
          </SubmitButton>

          <div style={{ marginTop: '2rem', textAlign: 'center', fontSize: '0.9rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Already have an account? </span>
            <Link href="/login">Sign in here</Link>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={
      <div className="auth-wrapper">
        <div className="glass-panel auth-form-container" style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--text-secondary)' }}>Loading...</p>
        </div>
      </div>
    }>
      <SignupForm />
    </Suspense>
  );
}
