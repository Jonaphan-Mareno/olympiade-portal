import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import SignOutButton from '@/app/organiser/SignOutButton';
import { db } from '@/lib/db';
import { users, memberships, portals } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

// Every new account — organiser signups and invite claims alike — is sent
// here by the signup action, with the page they were heading to in ?next=.
// Only allow in-app redirect targets (never protocol-relative "//" URLs)
// so the parameter can't be turned into an open redirect.
function safeNextTarget(raw: string | undefined): string {
  return raw && raw.startsWith('/') && !raw.startsWith('//')
    ? raw
    : '/dashboard';
}

const roleLabels: Record<string, string> = {
  admin: 'Admin',
  organiser: 'Organiser',
  educator: 'Educator',
  student: 'Student',
  reviewer: 'Reviewer',
};

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next: rawNext } = await searchParams;
  const next = safeNextTarget(rawNext);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/');
  }

  const [dbUser] = await db.select().from(users).where(eq(users.id, user.id));
  const displayName =
    dbUser?.name || user.user_metadata?.full_name || user.email;
  const firstName = displayName?.split(' ')[0] || 'there';

  // Which olympiads this new user just joined (claimed invites are accepted
  // during signup, so this lists the portals behind the welcome).
  const joined = await db
    .select({ portalName: portals.name, role: memberships.role })
    .from(memberships)
    .innerJoin(portals, eq(portals.id, memberships.portalId))
    .where(
      and(eq(memberships.userId, user.id), eq(memberships.status, 'accepted'))
    );

  const isEducator = joined.some((m) => m.role === 'educator');
  const isStudent = !isEducator && joined.some((m) => m.role === 'student');

  let nextSteps: string;
  if (isEducator) {
    nextSteps =
      'Head to your educator portal to manage your school, download question papers, and track learner submissions.';
  } else if (isStudent) {
    nextSteps =
      'Head to your results page to see your rounds and results as they are published.';
  } else {
    nextSteps =
      'Complete your organiser application to host your first olympiad — you can submit it from your dashboard at any time.';
  }

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
      <main
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '3rem 1rem',
        }}
      >
        <div
          style={{
            backgroundColor: '#FFFFFF',
            border: '1px solid #E2E8F0',
            borderRadius: '0.75rem',
            boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
            padding: '3rem 2.5rem',
            maxWidth: '560px',
            width: '100%',
            textAlign: 'center',
          }}
        >
          <Image
            src="/images/logo-BIG-v2.jpg"
            alt="Olympia Logo"
            width={72}
            height={72}
            style={{ objectFit: 'contain', margin: '0 auto' }}
          />
          <h1
            className="font-serif"
            style={{
              fontSize: '2.25rem',
              fontWeight: 700,
              color: '#0F172A',
              margin: '1.5rem 0 0.5rem',
              letterSpacing: '-0.02em',
            }}
          >
            Welcome to Olympia, {firstName}!
          </h1>
          <p
            style={{
              fontSize: '1.05rem',
              color: '#64748B',
              margin: 0,
            }}
          >
            Your account is ready — we&apos;re excited to have you on board.
          </p>

          {joined.length > 0 && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
                gap: '0.5rem',
                marginTop: '1.5rem',
              }}
            >
              {joined.map((m, i) => (
                <span
                  key={`${m.portalName}-${m.role}-${i}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.375rem',
                    backgroundColor: '#EFF6FF',
                    border: '1px solid #BFDBFE',
                    color: '#1E40AF',
                    borderRadius: '9999px',
                    padding: '0.375rem 0.875rem',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                  }}
                >
                  {m.portalName}
                  <span style={{ color: '#60A5FA' }}>·</span>
                  {roleLabels[m.role] ?? m.role}
                </span>
              ))}
            </div>
          )}

          <div
            style={{
              backgroundColor: '#F8FAFC',
              border: '1px solid #E2E8F0',
              borderRadius: '0.5rem',
              padding: '1rem 1.25rem',
              margin: '1.5rem 0',
              color: '#475569',
              fontSize: '0.95rem',
              lineHeight: 1.6,
            }}
          >
            {nextSteps}
          </div>

          <Link
            href={next}
            style={{
              display: 'inline-block',
              backgroundColor: '#0066CC',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: '0.375rem',
              padding: '0.75rem 2rem',
              fontSize: '1rem',
              fontWeight: 600,
              textDecoration: 'none',
              cursor: 'pointer',
            }}
          >
            Get Started
          </Link>
        </div>
      </main>
    </div>
  );
}
