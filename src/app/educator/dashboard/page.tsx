import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { memberships, portals, schools } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { logout } from '@/app/auth/actions';
import InviteStudentsForm from '@/components/educator/InviteStudentsForm';

export const dynamic = 'force-dynamic';

export default async function EducatorDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Get all educator memberships for this user
  const educatorMemberships = await db
    .select()
    .from(memberships)
    .where(and(
      eq(memberships.userId, user.id),
      eq(memberships.role, 'educator'),
    ));

  if (educatorMemberships.length === 0) {
    redirect('/dashboard');
  }

  // Fetch related portals and schools
  const portalIds = [...new Set(educatorMemberships.map(m => m.portalId))];
  const schoolIds = educatorMemberships
    .map(m => m.schoolId)
    .filter((id): id is string => !!id);

  const [portalRows, schoolRows] = await Promise.all([
    portalIds.length > 0
      ? db.select().from(portals).where(inArray(portals.id, portalIds))
      : Promise.resolve([]),
    schoolIds.length > 0
      ? db.select().from(schools).where(inArray(schools.id, schoolIds))
      : Promise.resolve([]),
  ]);

  const portalMap = new Map(portalRows.map(p => [p.id, p]));
  const schoolMap = new Map(schoolRows.map(s => [s.id, s]));

  // Fetch students for each school
  const studentMemberships = schoolIds.length > 0
    ? await db
        .select()
        .from(memberships)
        .where(and(
          inArray(memberships.schoolId, schoolIds),
          eq(memberships.role, 'student'),
        ))
    : [];

  // Group students by school
  const studentsBySchool = new Map<string, typeof studentMemberships>();
  for (const s of studentMemberships) {
    if (!s.schoolId) continue;
    const list = studentsBySchool.get(s.schoolId) ?? [];
    list.push(s);
    studentsBySchool.set(s.schoolId, list);
  }

  return (
    <div className="container" style={{ paddingTop: '4rem' }}>
      <div className="glass-panel" style={{ padding: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' }}>
          <div>
            <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Educator Dashboard</h1>
            <p style={{ color: 'var(--text-secondary)' }}>
              Welcome, {user.email}
            </p>
          </div>
          <form action={logout}>
            <button className="btn btn-secondary" type="submit" style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}>
              Sign Out
            </button>
          </form>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {educatorMemberships.map(membership => {
            const portal = portalMap.get(membership.portalId);
            const school = membership.schoolId ? schoolMap.get(membership.schoolId) : null;
            const schoolStudents = membership.schoolId ? (studentsBySchool.get(membership.schoolId) ?? []) : [];

            return (
              <div key={membership.id} className="glass-card" style={{ padding: '1.5rem' }}>
                {/* School header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <div>
                    <h2 style={{ fontSize: '1.15rem' }}>{school?.name ?? 'Unassigned School'}</h2>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{portal?.name ?? 'Portal'}</span>
                  </div>
                  <span style={{
                    fontSize: '0.75rem',
                    padding: '0.25rem 0.75rem',
                    borderRadius: 'var(--radius-sm)',
                    background: membership.status === 'accepted' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                    color: membership.status === 'accepted' ? 'var(--success-color)' : 'var(--text-secondary)',
                    border: `1px solid ${membership.status === 'accepted' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.1)'}`,
                  }}>
                    {membership.status}
                  </span>
                </div>

                {/* Existing students */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <h3 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                    Students ({schoolStudents.length})
                  </h3>
                  {schoolStudents.length === 0 ? (
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                      No students yet. Invite some below.
                    </p>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                      {schoolStudents.map(student => (
                        <span
                          key={student.id}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            padding: '0.25rem 0.6rem',
                            background: student.status === 'accepted'
                              ? 'rgba(16, 185, 129, 0.08)'
                              : 'rgba(255, 255, 255, 0.04)',
                            border: `1px solid ${student.status === 'accepted'
                              ? 'rgba(16, 185, 129, 0.15)'
                              : 'rgba(255, 255, 255, 0.08)'}`,
                            borderRadius: 'var(--radius-sm)',
                            fontSize: '0.8rem',
                            color: 'var(--text-primary)',
                          }}
                        >
                          {student.invitedEmail}
                          {student.status === 'invited' && (
                            <span style={{
                              marginLeft: '0.4rem',
                              fontSize: '0.65rem',
                              color: 'var(--text-secondary)',
                              background: 'rgba(255, 255, 255, 0.05)',
                              padding: '0.1rem 0.35rem',
                              borderRadius: '0.25rem',
                            }}>
                              pending
                            </span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Invite students form */}
                {membership.schoolId && (
                  <div style={{
                    padding: '1rem',
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: 'var(--radius-md)',
                  }}>
                    <h3 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                      Add Students
                    </h3>
                    <InviteStudentsForm
                      portalId={membership.portalId}
                      schoolId={membership.schoolId}
                      schoolName={school?.name ?? ''}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
