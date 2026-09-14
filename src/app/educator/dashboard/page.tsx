import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { memberships, portals, schools } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import InviteStudentsForm from '@/components/educator/InviteStudentsForm';

export const dynamic = 'force-dynamic';

export default async function EducatorDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Get all educator memberships for this user
  const educatorMemberships = await db
    .select()
    .from(memberships)
    .where(
      and(eq(memberships.userId, user.id), eq(memberships.role, 'educator'))
    );

  if (educatorMemberships.length === 0) {
    redirect('/dashboard');
  }

  // Fetch related portals and schools
  const portalIds = [...new Set(educatorMemberships.map((m) => m.portalId))];
  const schoolIds = educatorMemberships
    .map((m) => m.schoolId)
    .filter((id): id is string => !!id);

  const [portalRows, schoolRows] = await Promise.all([
    portalIds.length > 0
      ? db.select().from(portals).where(inArray(portals.id, portalIds))
      : Promise.resolve([]),
    schoolIds.length > 0
      ? db.select().from(schools).where(inArray(schools.id, schoolIds))
      : Promise.resolve([]),
  ]);

  const portalMap = new Map(portalRows.map((p) => [p.id, p]));
  const schoolMap = new Map(schoolRows.map((s) => [s.id, s]));

  // Fetch students for each school — scoped to the membership's portal so a
  // school row shared across olympiads (legacy data) never leaks participants
  const studentMemberships =
    schoolIds.length > 0
      ? await db
          .select()
          .from(memberships)
          .where(
            and(
              inArray(memberships.schoolId, schoolIds),
              inArray(memberships.portalId, portalIds),
              eq(memberships.role, 'student')
            )
          )
      : [];

  // Group students per (portal, school) pair
  const studentsBySchool = new Map<string, typeof studentMemberships>();
  for (const s of studentMemberships) {
    if (!s.schoolId) continue;
    const key = `${s.portalId}:${s.schoolId}`;
    const list = studentsBySchool.get(key) ?? [];
    list.push(s);
    studentsBySchool.set(key, list);
  }

  const displayName = user.user_metadata?.full_name || user.email;
  const firstName = displayName || 'Educator';

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#F8FAFC',
        padding: '2rem 1rem',
      }}
    >
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <h1
          style={{
            fontSize: '2.25rem',
            fontWeight: 'bold',
            color: '#0F172A',
            marginBottom: '0.5rem',
          }}
        >
          Educator Dashboard
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

        <div
          style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}
        >
          {educatorMemberships.map((membership) => {
            const portal = portalMap.get(membership.portalId);
            const school = membership.schoolId
              ? schoolMap.get(membership.schoolId)
              : null;
            const schoolStudents = membership.schoolId
              ? (studentsBySchool.get(
                  `${membership.portalId}:${membership.schoolId}`
                ) ?? [])
              : [];

            return (
              <div
                key={membership.id}
                style={{
                  backgroundColor: '#FFFFFF',
                  border: '1px solid #E2E8F0',
                  borderRadius: '0.75rem',
                  boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
                  padding: '1.5rem',
                }}
              >
                {/* School header */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '1rem',
                  }}
                >
                  <div>
                    <h2
                      style={{
                        fontSize: '1.15rem',
                        fontWeight: '600',
                        color: '#1E293B',
                      }}
                    >
                      {school?.name ?? 'Unassigned School'}
                    </h2>
                    <span
                      style={{
                        fontSize: '0.8rem',
                        color: '#64748B',
                      }}
                    >
                      {portal?.name ?? 'Portal'}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: '600',
                      padding: '0.25rem 0.75rem',
                      borderRadius: '9999px',
                      background:
                        membership.status === 'accepted'
                          ? '#DCFCE7'
                          : '#F1F5F9',
                      color:
                        membership.status === 'accepted'
                          ? '#166534'
                          : '#475569',
                    }}
                  >
                    {membership.status}
                  </span>
                </div>

                {/* Existing students */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <h3
                    style={{
                      fontSize: '0.9rem',
                      fontWeight: '600',
                      color: '#334155',
                      marginBottom: '0.5rem',
                    }}
                  >
                    Students ({schoolStudents.length})
                  </h3>
                  {schoolStudents.length === 0 ? (
                    <p
                      style={{
                        fontSize: '0.85rem',
                        color: '#64748B',
                        fontStyle: 'italic',
                      }}
                    >
                      No students yet. Invite some below.
                    </p>
                  ) : (
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '0.4rem',
                      }}
                    >
                      {schoolStudents.map((student) => (
                        <span
                          key={student.id}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            padding: '0.25rem 0.6rem',
                            background:
                              student.status === 'accepted'
                                ? '#F0FDF4'
                                : '#F8FAFC',
                            border: `1px solid ${
                              student.status === 'accepted'
                                ? '#BBF7D0'
                                : '#E2E8F0'
                            }`,
                            borderRadius: '0.375rem',
                            fontSize: '0.8rem',
                            color:
                              student.status === 'accepted'
                                ? '#166534'
                                : '#475569',
                          }}
                        >
                          {student.invitedEmail}
                          {student.status === 'invited' && (
                            <span
                              style={{
                                marginLeft: '0.4rem',
                                fontSize: '0.65rem',
                                color: '#64748B',
                                background: '#F1F5F9',
                                padding: '0.1rem 0.35rem',
                                borderRadius: '0.25rem',
                              }}
                            >
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
                  <div
                    style={{
                      padding: '1rem',
                      background: '#F8FAFC',
                      border: '1px solid #E2E8F0',
                      borderRadius: '0.5rem',
                    }}
                  >
                    <h3
                      style={{
                        fontSize: '0.9rem',
                        fontWeight: '600',
                        color: '#334155',
                        marginBottom: '0.75rem',
                      }}
                    >
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
