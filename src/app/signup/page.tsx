'use client';

import { useState, Suspense } from 'react';
import { signup } from '@/app/auth/actions';
import { SubmitButton } from '@/components/SubmitButton';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';

function SignupForm() {
  const searchParams = useSearchParams();
  const inviteToken =
    searchParams.get('inviteToken') || searchParams.get('token');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setError(null);
    const result = await signup(formData);
    if (result?.error) {
      setError(result.error);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        margin: 0,
        padding: 0,
        backgroundColor: '#FFFFFF',
        color: '#000000',
        fontFamily: 'inherit',
      }}
    >
      <style
        dangerouslySetInnerHTML={{
          __html: `
        /* Override global background just for this page */
        body { 
          background: #FFFFFF !important; 
          color: #000000 !important; 
        }
        
        /* Input Overrides */
        .signup-input { 
          background: #FFFFFF !important; 
          border: 1px solid #CCCCCC !important; 
          color: #000000 !important; 
          border-radius: 4px !important; 
          padding: 0.75rem 1rem !important; 
          width: 100% !important; 
          box-shadow: none !important; 
          outline: none !important; 
          transition: none !important; 
        }
        .signup-input:focus { 
          border-color: #0066CC !important; 
        }
        
        .signup-label { 
          color: #333333 !important; 
          font-weight: 500 !important; 
          font-size: 0.875rem !important; 
          margin-bottom: 0.5rem !important; 
          display: block !important; 
          text-align: left !important; 
        }

        /* Button Overrides */
        .signup-btn { 
          background: #1e3a8a !important;
          color: white !important;
          border: none !important; 
          border-radius: 4px !important; 
          padding: 0.75rem 1.5rem !important; 
          width: 100% !important; 
          box-shadow: none !important; 
          transform: none !important;
        }
        .signup-btn:hover {
          background: #1e40af !important;
        }
      `,
        }}
      />

      {/* Left Panel (Brand) */}
      <motion.div
        initial={{ x: '100vw' }}
        animate={{ x: 0 }}
        transition={{ duration: 0.5, ease: 'easeInOut' }}
        style={{
          flex: 1,
          backgroundColor: '#0066CC',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          position: 'relative',
        }}
      >
        <div
          style={{
            maxWidth: '500px',
            width: '100%',
            textAlign: 'center',
            color: '#FFFFFF',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: '100%',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              width: '100%',
              marginBottom: '2rem',
              flexShrink: 1,
              minHeight: 0,
            }}
          >
            <img
              src="/images/logo-reverted.jpg"
              alt="Olympia Logo"
              style={{
                maxHeight: '350px',
                height: '100%',
                width: 'auto',
                objectFit: 'contain',
              }}
            />
          </div>
          <h2
            className="font-serif"
            style={{
              fontSize: '3.5rem',
              fontWeight: 700,
              lineHeight: 1.1,
              margin: 0,
              letterSpacing: '-0.02em',
            }}
          >
            Host world-class olympiads.
          </h2>
          <p
            style={{
              fontSize: '1.25rem',
              lineHeight: 1.6,
              color: 'rgba(255, 255, 255, 0.8)',
              margin: '1.5rem 0 0 0',
            }}
          >
            Create your organiser account to build custom portals, invite
            educators, and manage academic competitions effortlessly.
          </p>
        </div>

        {/* Layered Vertical Wave Divider */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            right: '-149px',
            width: '150px',
            zIndex: 10,
            pointerEvents: 'none',
          }}
        >
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ width: '100%', height: '100%', display: 'block' }}
          >
            {/* Lightest Back Wave */}
            <path
              d="M0,0 C100,30 0,70 80,100 L0,100 Z"
              fill="#0066CC"
              opacity="0.3"
            />
            {/* Mid Layer Wave */}
            <path
              d="M0,0 C70,35 10,65 50,100 L0,100 Z"
              fill="#0066CC"
              opacity="0.6"
            />
            {/* Solid Front Wave */}
            <path d="M0,0 C40,40 20,60 30,100 L0,100 Z" fill="#0066CC" />
          </svg>
        </div>
      </motion.div>

      {/* Right Panel (Action) */}
      <motion.div
        initial={{ x: '-100vw' }}
        animate={{ x: 0 }}
        transition={{ duration: 0.5, ease: 'easeInOut' }}
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          padding: '2rem',
        }}
      >
        {/* Form Container */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ width: '100%', maxWidth: '380px' }}>
            <h1
              className="font-serif"
              style={{
                fontSize: '2.25rem',
                fontWeight: 700,
                marginBottom: '0.5rem',
                textAlign: 'left',
                color: '#000000',
                letterSpacing: '-0.02em',
              }}
            >
              {inviteToken ? 'Claim Your Account' : 'Apply as an Organiser'}
            </h1>
            <p
              style={{
                color: '#64748B',
                fontSize: '0.95rem',
                marginBottom: '2rem',
                textAlign: 'left',
              }}
            >
              {inviteToken
                ? 'You have been invited to join an Olympiad.'
                : 'Register to manage and run your academic olympiads.'}
            </p>

            <form
              action={handleSubmit}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '1.25rem',
              }}
            >
              {error && (
                <div
                  style={{
                    backgroundColor: '#FEE2E2',
                    color: '#DC2626',
                    padding: '0.75rem',
                    borderRadius: '4px',
                    border: '1px solid #F87171',
                    fontSize: '0.875rem',
                  }}
                >
                  {error}
                </div>
              )}

              {inviteToken && (
                <input type="hidden" name="inviteToken" value={inviteToken} />
              )}

              <div>
                <label className="signup-label" htmlFor="name">
                  Full Name
                </label>
                <input
                  className="signup-input"
                  type="text"
                  name="name"
                  id="name"
                  required
                />
              </div>

              <div>
                <label className="signup-label" htmlFor="email">
                  Email Address
                </label>
                <input
                  className="signup-input"
                  type="email"
                  name="email"
                  id="email"
                  required
                />
              </div>

              <div>
                <label className="signup-label" htmlFor="password">
                  Password
                </label>
                <input
                  className="signup-input"
                  type="password"
                  name="password"
                  id="password"
                  required
                  minLength={6}
                />
              </div>

              <div style={{ marginTop: '0.5rem' }}>
                <SubmitButton
                  pendingText="Creating Account..."
                  className="signup-btn bg-blue-900 hover:bg-blue-800 text-white font-semibold transition-colors"
                >
                  {inviteToken ? 'Claim Account' : 'Sign Up as Organiser'}
                </SubmitButton>
              </div>

              <div
                style={{
                  marginTop: '1.5rem',
                  textAlign: 'center',
                  fontSize: '0.875rem',
                }}
              >
                <span style={{ color: '#64748B' }}>
                  Already have an account?{' '}
                </span>
                <Link
                  href="/"
                  className="text-blue-900 hover:text-blue-800 transition-colors"
                  style={{
                    textDecoration: 'none',
                    fontWeight: 600,
                  }}
                >
                  Sign in.
                </Link>
              </div>
            </form>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            display: 'flex',
            height: '100vh',
            width: '100vw',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#FFFFFF',
            color: '#64748B',
          }}
        >
          <p>Loading...</p>
        </div>
      }
    >
      <SignupForm />
    </Suspense>
  );
}
