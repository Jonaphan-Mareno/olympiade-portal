import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import SignOutButton from '@/app/organiser/SignOutButton';
import { db } from '@/lib/db';
import { users, memberships, organiserApplications } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect('/login');
  }

  const [dbUser] = await db.select().from(users).where(eq(users.id, user.id));
  const isAdmin = dbUser?.isPlatformAdmin === true;

  if (isAdmin) {
    redirect('/admin/dashboard');
  }

  // Check if user has educator memberships
  const educatorMemberships = await db
    .select()
    .from(memberships)
    .where(
      and(eq(memberships.userId, user.id), eq(memberships.role, 'educator'))
    );
  const isEducator = educatorMemberships.length > 0;

  // Check if user has student memberships
  const studentMemberships = await db
    .select()
    .from(memberships)
    .where(
      and(eq(memberships.userId, user.id), eq(memberships.role, 'student'))
    );
  const isStudent = studentMemberships.length > 0;

  // Check if user is an unverified organiser
  const [application] = await db
    .select()
    .from(organiserApplications)
    .where(eq(organiserApplications.userId, user.id));

  const hasOtherRoles = isAdmin || isEducator || isStudent;

  // Organisers (any application state) land on this hub like every other
  // signed-in user, so the header logo consistently returns to the main
  // dashboard. Only brand-new accounts with no roles and no application
  // are funnelled straight to the organiser application form.
  if (!hasOtherRoles && !application) {
    redirect('/organiser/dashboard');
  }

  const displayName =
    dbUser?.name || user.user_metadata?.full_name || user.email;
  const firstName = displayName?.split(' ')[0] || 'User';

  const cardLinkStyle = {
    display: 'inline-block',
    backgroundColor: '#0066CC',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '0.375rem',
    padding: '0.5rem 1rem',
    fontSize: '0.875rem',
    fontWeight: '500',
    textDecoration: 'none',
    cursor: 'pointer',
  } as const;

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#F8FAFC',
      }}
    >
      <header
        style={{
          backgroundColor: '#FFFFFF',
          borderBottom: '1px solid #E2E8F0',
          padding: '1rem 2rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          position: 'sticky',
          top: 0,
          zIndex: 50,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <Image
            src="/images/logo-BIG-v2.jpg"
            alt="Olympia Logo"
            width={32}
            height={32}
            style={{ objectFit: 'contain' }}
          />
          <span
            style={{
              color: '#0066CC',
              fontWeight: 'bold',
              fontSize: '1.25rem',
            }}
          >
            Olympia
          </span>
        </div>

        <SignOutButton />
      </header>
      <main style={{ flex: 1 }}>
        <div
          style={{
            padding: '3rem 1rem',
          }}
        >
          <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
            <h1
              style={{
                fontSize: '2.25rem',
                fontWeight: 'bold',
                color: '#0F172A',
                marginBottom: '0.5rem',
              }}
            >
              Dashboard
            </h1>
            <p
              style={{
                fontSize: '1.1rem',
                color: '#64748B',
                marginBottom: '2rem',
              }}
            >
              Welcome back, {firstName}!
            </p>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                gap: '1.5rem',
              }}
            >
              {isEducator && (
                <div
                  style={{
                    backgroundColor: '#FFFFFF',
                    border: '1px solid #E2E8F0',
                    borderRadius: '0.75rem',
                    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
                    padding: '1.5rem',
                  }}
                >
                  <h2
                    style={{
                      fontSize: '1.25rem',
                      fontWeight: '600',
                      color: '#1E293B',
                      marginBottom: '0.5rem',
                    }}
                  >
                    Educator View
                  </h2>
                  <p
                    style={{
                      color: '#64748B',
                      fontSize: '0.9rem',
                      marginBottom: '1rem',
                    }}
                  >
                    Manage your classes, view submissions, and track student
                    progress.
                  </p>
                  <Link href="/educator/dashboard" style={cardLinkStyle}>
                    Go to Educator Portal
                  </Link>
                </div>
              )}

              {isStudent && (
                <div
                  style={{
                    backgroundColor: '#FFFFFF',
                    border: '1px solid #E2E8F0',
                    borderRadius: '0.75rem',
                    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
                    padding: '1.5rem',
                  }}
                >
                  <h2
                    style={{
                      fontSize: '1.25rem',
                      fontWeight: '600',
                      color: '#1E293B',
                      marginBottom: '0.5rem',
                    }}
                  >
                    Student View
                  </h2>
                  <p
                    style={{
                      color: '#64748B',
                      fontSize: '0.9rem',
                      marginBottom: '1rem',
                    }}
                  >
                    View your results, submissions, and upcoming rounds.
                  </p>
                  <Link href="/results" style={cardLinkStyle}>
                    Go to Results
                  </Link>
                </div>
              )}

              <div
                style={{
                  backgroundColor: '#FFFFFF',
                  border: '1px solid #E2E8F0',
                  borderRadius: '0.75rem',
                  boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
                  padding: '1.5rem',
                }}
              >
                <h2
                  style={{
                    fontSize: '1.25rem',
                    fontWeight: '600',
                    color: '#1E293B',
                    marginBottom: '0.5rem',
                  }}
                >
                  Organiser View
                </h2>
                <p
                  style={{
                    color: '#64748B',
                    fontSize: '0.9rem',
                    marginBottom: '1rem',
                  }}
                >
                  Manage your Olympiads, create rounds, and view applications.
                </p>
                <Link href="/organiser/dashboard" style={cardLinkStyle}>
                  Go to Organiser Portal
                </Link>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
