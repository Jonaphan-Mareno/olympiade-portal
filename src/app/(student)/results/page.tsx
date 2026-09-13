import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { memberships, portals, schools } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function ResultsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const studentMemberships = await db
    .select()
    .from(memberships)
    .where(
      and(eq(memberships.userId, user.id), eq(memberships.role, 'student'))
    );

  if (studentMemberships.length === 0) {
    redirect('/dashboard');
  }

  const portalIds = [...new Set(studentMemberships.map((m) => m.portalId))];
  const schoolIds = studentMemberships
    .map((m) => m.schoolId)
    .filter((id): id is string => !!id);

  const [portalRows, schoolRows] = await Promise.all([
    portalIds.length > 0
      ? db.select().from(portals).where(inArray(portals.id, portalIds))
      : [],
    schoolIds.length > 0
      ? db.select().from(schools).where(inArray(schools.id, schoolIds))
      : [],
  ]);

  const portalMap = new Map(portalRows.map((p) => [p.id, p]));
  const schoolMap = new Map(schoolRows.map((s) => [s.id, s]));

  const displayName = user.user_metadata?.full_name || user.email;
  const firstName = displayName?.split(' ')[0] || 'Student';

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#F8FAFC',
        padding: '2rem 1rem',
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
          Student Dashboard
        </h1>
        <p
          style={{
            fontSize: '1.1rem',
            color: '#64748B',
            marginBottom: '2rem',
          }}
        >
          Welcome, {firstName}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {studentMemberships.map((m) => {
            const portal = portalMap.get(m.portalId);
            const school = m.schoolId ? schoolMap.get(m.schoolId) : null;
            return (
              <Link
                href={`/results/${m.portalId}`}
                key={m.id}
                style={{
                  backgroundColor: '#FFFFFF',
                  border: '1px solid #E2E8F0',
                  borderRadius: '0.75rem',
                  boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
                  padding: '1.25rem',
                  textDecoration: 'none',
                  display: 'block',
                  transition: 'all 0.2s',
                  color: 'inherit'
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '0.5rem',
                  }}
                >
                  <h3
                    style={{
                      fontSize: '1.1rem',
                      fontWeight: '600',
                      color: '#1E293B',
                    }}
                  >
                    {portal?.name ?? 'Portal'}
                  </h3>
                  <span
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: '600',
                      padding: '0.25rem 0.75rem',
                      borderRadius: '9999px',
                      background: m.status === 'accepted' ? '#DCFCE7' : '#F1F5F9',
                      color: m.status === 'accepted' ? '#166534' : '#475569',
                    }}
                  >
                    {m.status}
                  </span>
                </div>
                {school && (
                  <div
                    style={{
                      fontSize: '0.9rem',
                      paddingLeft: '0.75rem',
                      borderLeft: '2px solid #0066CC',
                      color: '#475569',
                    }}
                  >
                    {school.name}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
