import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { memberships, portals, schools } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { logout } from '@/app/auth/actions';

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

  return (
    <div className="container" style={{ paddingTop: '4rem' }}>
      <div className="glass-panel" style={{ padding: '2rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: '2rem',
          }}
        >
          <div>
            <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>
              Student Dashboard
            </h1>
            <p style={{ color: 'var(--text-secondary)' }}>
              Welcome, {user.email}
            </p>
          </div>
          <form action={logout}>
            <button
              className="btn btn-secondary"
              type="submit"
              style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}
            >
              Sign Out
            </button>
          </form>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {studentMemberships.map((m) => {
            const portal = portalMap.get(m.portalId);
            const school = m.schoolId ? schoolMap.get(m.schoolId) : null;
            return (
              <div
                key={m.id}
                className="glass-card"
                style={{ padding: '1.25rem' }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '0.5rem',
                  }}
                >
                  <h3 style={{ fontSize: '1.1rem' }}>
                    {portal?.name ?? 'Portal'}
                  </h3>
                  <span
                    style={{
                      fontSize: '0.75rem',
                      padding: '0.25rem 0.75rem',
                      borderRadius: 'var(--radius-sm)',
                      background:
                        m.status === 'accepted'
                          ? 'rgba(16, 185, 129, 0.1)'
                          : 'rgba(255, 255, 255, 0.05)',
                      color:
                        m.status === 'accepted'
                          ? 'var(--success-color)'
                          : 'var(--text-secondary)',
                      border: `1px solid ${m.status === 'accepted' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.1)'}`,
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
                      borderLeft: '2px solid var(--primary-color)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {school.name}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <p
          style={{
            color: 'var(--text-secondary)',
            marginTop: '2rem',
            fontSize: '0.9rem',
          }}
        >
          Results and submissions will appear here once rounds are available.
        </p>
      </div>
    </div>
  );
}
