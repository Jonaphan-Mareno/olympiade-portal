'use client';

import { useState } from 'react';
import { login } from '@/app/auth/actions';
import { SubmitButton } from '@/components/SubmitButton';
import Link from 'next/link';

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setError(null);
    const result = await login(formData);
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
          <h1 className="auth-title">Welcome Back</h1>
          <p className="auth-subtitle">Sign in to your Olympiad Portal account</p>
        </div>

        <form action={handleSubmit}>
          {error && <div className="form-error">{error}</div>}

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
            />
            <label className="input-label" htmlFor="password">Password</label>
          </div>

          <SubmitButton pendingText="Signing In...">
            Sign In
          </SubmitButton>

          <div style={{ marginTop: '2rem', textAlign: 'center', fontSize: '0.9rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Don't have an account? </span>
            <Link href="/signup">Register here</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
