import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { memberships, portals, schools } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import InviteStudentsForm from '@/components/educator/InviteStudentsForm';

export const dynamic = 'force-dynamic';

export default async function EducatorEntrantsPage() {
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

  const cookieStore = await cookies();
  const activeSchoolId = cookieStore.get('active_school_id')?.value;

  // Identify all memberships for the active school (or fallback to the first membership's school)
  const activeSchoolMemberships = activeSchoolId 
    ? educatorMemberships.filter(m => m.schoolId === activeSchoolId)
    : educatorMemberships.filter(m => m.schoolId === educatorMemberships[0].schoolId);

  if (activeSchoolMemberships.length === 0) {
    return <div>No school assigned.</div>;
  }

  const currentSchoolId = activeSchoolMemberships[0].schoolId;
  const portalIds = activeSchoolMemberships.map(m => m.portalId);

  // Fetch the school details and all relevant portals
  const [schoolRows, portalRows] = await Promise.all([
    currentSchoolId ? db.select().from(schools).where(eq(schools.id, currentSchoolId)) : Promise.resolve([]),
    portalIds.length > 0 ? db.select().from(portals).where(inArray(portals.id, portalIds)) : Promise.resolve([])
  ]);

  const school = schoolRows[0] || null;

  // Fetch all student memberships for this school
  const studentMemberships = currentSchoolId
    ? await db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.schoolId, currentSchoolId),
            inArray(memberships.portalId, portalIds),
            eq(memberships.role, 'student')
          )
        )
    : [];

  // Group students by portalId
  const studentsByPortal = new Map<string, typeof studentMemberships>();
  for (const s of studentMemberships) {
    const list = studentsByPortal.get(s.portalId) ?? [];
    list.push(s);
    studentsByPortal.set(s.portalId, list);
  }

  return (
    <div className="min-h-screen bg-white font-sans w-full px-4 md:px-8 pt-10 pb-20">
      <div className="max-w-4xl mx-auto">
        <h1 className="font-serif text-3xl font-bold text-slate-900 mb-8">
          Manage Olympiads
        </h1>

        <div className="flex flex-col gap-12">
          {portalRows.map(portal => {
            const schoolStudents = studentsByPortal.get(portal.id) || [];
            
            return (
              <div key={portal.id} className="flex flex-col border border-slate-200 rounded-md bg-white">
                <div className="flex flex-row justify-between items-center bg-blue-900 p-4 px-6">
                  <h2 className="font-serif text-xl font-bold text-white m-0">
                    {portal.name}
                  </h2>
                </div>

                <div className="flex flex-col bg-white">
                  {/* Students list */}
                  <div className="p-6 md:p-8 border-b border-slate-200">
                    <h3 className="font-serif text-lg font-bold text-slate-900 mb-4">
                      Registered Students ({schoolStudents.length})
                    </h3>
                    
                    {schoolStudents.length === 0 ? (
                      <div className="text-center py-8 border border-dashed border-slate-300 rounded-lg bg-slate-50">
                        <p className="text-slate-500 mb-0 italic">
                          No students have been invited yet.
                        </p>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {schoolStudents.map((student) => (
                          <span
                            key={student.id}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm ${
                              student.status === 'accepted'
                                ? 'bg-orange-50 border-orange-300 text-orange-900'
                                : 'bg-slate-50 border-slate-200 text-slate-600'
                            }`}
                          >
                            {student.invitedEmail}
                            {student.status !== 'accepted' && (
                              <span className="text-[0.65rem] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded uppercase tracking-wider font-semibold">
                                pending
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Invite students form */}
                  {currentSchoolId && (
                    <div className="p-6 md:p-8 bg-white">
                      <h3 className="font-serif text-lg font-bold text-slate-900 mb-4">
                        Invite More Students
                      </h3>
                      <InviteStudentsForm
                        portalId={portal.id}
                        schoolId={currentSchoolId}
                        schoolName={school?.name ?? ''}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
