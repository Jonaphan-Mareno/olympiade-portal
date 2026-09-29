import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { memberships, users, portals, rounds, roundQualifications } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import Link from 'next/link';
import { deriveRoundState } from '@/domain/rounds/round-state-machine';

export default async function StudentRoundsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Fetch the student's global school_id from their user profile
  const [currentUser] = await db.select({ schoolId: users.schoolId }).from(users).where(eq(users.id, user.id));
  const globalSchoolId = currentUser?.schoolId;

  const studentMemberships = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, user.id),
        eq(memberships.role, 'student'),
        //globalSchoolId ? eq(memberships.schoolId, globalSchoolId) : undefined
      )
    );

  if (studentMemberships.length === 0) {
    return (
      <div className="min-h-screen bg-[#F8FAFC]">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <p className="text-slate-600">You are not enrolled in any Olympiads yet.</p>
        </div>
      </div>
    );
  }

  const portalIds = [...new Set(studentMemberships.map((m) => m.portalId))];
  const membershipIds = studentMemberships.map((m) => m.id);

  const enrolledPortals = portalIds.length > 0 
    ? await db.select().from(portals).where(inArray(portals.id, portalIds))
    : [];
    
  const allRounds = portalIds.length > 0 
    ? await db.select().from(rounds).where(inArray(rounds.portalId, portalIds)).orderBy(rounds.orderIndex)
    : [];

  // Fetch all qualifications for these student memberships
  const qualifications = membershipIds.length > 0
    ? await db.select().from(roundQualifications).where(inArray(roundQualifications.studentMembershipId, membershipIds))
    : [];

  const qualifiedRoundIds = new Set(qualifications.map(q => q.roundId));
  const now = new Date();

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <div className="bg-blue-950 p-8 text-white mb-8">
        <h1 className="text-3xl font-bold font-serif mb-2">Upcoming Olympiads</h1>
        <p className="text-blue-200">View all your upcoming Olympiads and scheduled rounds.</p>
      </div>
      
      <div className="max-w-6xl mx-auto px-4 md:px-8 pb-12">
        {enrolledPortals.length === 0 ? (
          <div className="bg-white p-12 text-center border-2 border-slate-200 text-slate-500 font-medium shadow-sm">
            You are not enrolled in any Olympiads yet.
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            {enrolledPortals.map((portal) => {
              const portalRounds = allRounds.filter(r => r.portalId === portal.id).sort((a, b) => a.orderIndex - b.orderIndex);
              
              return (
                <div key={portal.id} className="bg-white border-2 border-slate-200 shadow-sm flex flex-col">
                  <div className="bg-blue-950 p-4 px-6 flex justify-between items-center">
                    <h3 className="text-white font-bold uppercase tracking-wider text-sm">
                      {portal.name}
                    </h3>
                    <Link 
                      href={`/results/${portal.id}/rounds`} 
                      className="text-xs font-semibold text-blue-200 hover:text-white transition-colors"
                    >
                      View Portal Dashboard &rarr;
                    </Link>
                  </div>
                  
                  {portalRounds.length === 0 ? (
                    <div className="p-6 md:p-8 text-slate-500 font-medium text-center">
                      No rounds available for this Olympiad.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-200">
                      {portalRounds.map((round) => {
                        const state = deriveRoundState(round, now);
                        const isLocked = round.orderIndex > 1 && !qualifiedRoundIds.has(round.id);


                        return (
                          <div key={round.id} className="p-6 md:p-8 flex flex-col md:flex-row justify-between items-center gap-6">
                            <div>
                              <div className="flex items-center gap-3">
                                <span className="bg-slate-100 text-slate-600 px-2.5 py-1 rounded-md text-xs font-bold border border-slate-200 tracking-wide">
                                  Round {round.orderIndex}
                                </span>
                                <h4 className="text-xl font-bold text-slate-800">{round.name}</h4>
                                {isLocked && <span title="Locked: Not Qualified">🔒</span>}
                              </div>
                              <p className="text-slate-600 font-medium text-sm flex items-center gap-2 mt-1">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                {state === 'open' ? 'Opens/Closes: ' : (state === 'scheduled' ? 'Opens on: ' : 'Closed on: ')}
                                {new Date(round.opensAt).toLocaleDateString()} at {new Date(round.opensAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </div>

                            <div>
                              {isLocked ? (
                                <span className="bg-red-100 text-red-800 px-4 py-2 font-bold text-xs uppercase tracking-wider rounded border border-red-200">
                                  Locked (Not Qualified)
                                </span>
                              ) : state === 'open' ? (
                                <span className="bg-amber-400 text-amber-950 px-4 py-2 font-bold text-xs uppercase tracking-wider rounded border border-amber-500 shadow-sm flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-amber-900 animate-pulse"></span>
                                  Active Now
                                </span>
                              ) : state === 'scheduled' ? (
                                <span className="bg-blue-100 text-blue-800 px-4 py-2 font-bold text-xs uppercase tracking-wider rounded border border-blue-200">
                                  Upcoming
                                </span>
                              ) : (
                                <span className="bg-slate-100 text-slate-600 px-4 py-2 font-bold text-xs uppercase tracking-wider rounded border border-slate-200">
                                  Closed
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}