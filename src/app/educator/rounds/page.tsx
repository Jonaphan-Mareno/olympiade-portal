import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { memberships, rounds, portals } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { deriveRoundState } from '@/domain/rounds/round-state-machine';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function EducatorAssessmentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Get educator membership
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

  const activeSchoolMemberships = activeSchoolId 
    ? educatorMemberships.filter((m) => m.schoolId === activeSchoolId)
    : educatorMemberships.filter(m => m.schoolId === educatorMemberships[0].schoolId);

  if (activeSchoolMemberships.length === 0 || !activeSchoolMemberships[0].schoolId) {
    return <div>No school assigned.</div>;
  }
  
  const portalIds = activeSchoolMemberships.map(m => m.portalId);

  const portalRows = portalIds.length > 0 
    ? await db.select().from(portals).where(inArray(portals.id, portalIds))
    : [];

  // Fetch all rounds for the portals
  const allRounds = portalIds.length > 0 
    ? await db
        .select()
        .from(rounds)
        .where(inArray(rounds.portalId, portalIds))
        .orderBy(rounds.orderIndex)
    : [];

  const now = new Date();

  return (
    <div className="min-h-screen bg-white font-sans w-full px-4 md:px-8 pt-10 pb-20">
      <div className="max-w-4xl mx-auto">
        <h1 className="font-serif text-3xl font-bold text-slate-900 mb-8">
          Assessments
        </h1>
        <p className="text-slate-600 mb-8">
          Command center for downloading papers and grading submissions.
        </p>

        <div className="flex flex-col gap-12">
          {portalRows.map(portal => {
            const portalRounds = allRounds.filter(r => r.portalId === portal.id);
            
            if (portalRounds.length === 0) {
              return null;
            }

            return (
              <div key={portal.id} className="flex flex-col gap-6">
                <h2 className="font-serif text-2xl font-bold text-slate-800 border-b border-slate-200 pb-3">{portal.name}</h2>
                
                {portalRounds.map((round) => {
                  const state = deriveRoundState(round, now);
                  const isPaperOrHybrid = round.deliveryMethod === 'paper' || round.deliveryMethod === 'hybrid';
                  const unlockTime = new Date(round.opensAt.getTime() - 24 * 60 * 60 * 1000);
                  const isPrintWindowOpen = now >= unlockTime && state !== 'released' && state !== 'closed';
                  
                  return (
                    <div key={round.id} className="flex flex-col border border-slate-200 rounded-sm overflow-hidden bg-white">
                      <div className="flex flex-row justify-between items-center bg-blue-900 p-4 px-6 border-b border-slate-200">
                        <h3 className="font-serif text-xl font-bold text-white m-0">
                          {round.name}
                        </h3>
                        <span className="text-white font-semibold text-sm uppercase tracking-wider">
                          {state}
                        </span>
                      </div>

                      <div className="p-6 md:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                        <div className="flex flex-col gap-2">
                          <p className="text-slate-700 font-medium text-sm">
                            <span className="text-slate-500 uppercase tracking-wide text-xs">Opens: </span>
                            {round.opensAt ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(round.opensAt)) : 'Not set'}
                          </p>
                          <p className="text-slate-700 font-medium text-sm">
                            <span className="text-slate-500 uppercase tracking-wide text-xs">Closes: </span>
                            {round.closesAt ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(round.closesAt)) : 'Not set'}
                          </p>
                        </div>
                        
                        <div className="flex flex-wrap gap-3">
                          {isPaperOrHybrid && (state === 'scheduled' || state === 'open') && (
                            <button
                              disabled={!isPrintWindowOpen}
                              title={!isPrintWindowOpen ? 'Paper unlocks 24 hours before start' : undefined}
                              className={`inline-flex items-center justify-center px-4 py-2 border font-bold rounded-sm transition-colors ${
                                isPrintWindowOpen
                                  ? 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                                  : 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                              }`}
                            >
                              {!isPrintWindowOpen && <span className="mr-2">🔒</span>}
                              Download Question Paper
                            </button>
                          )}

                          {state === 'open' && isPaperOrHybrid && (
                            <button className="inline-flex items-center justify-center px-4 py-2 border border-slate-300 bg-white text-slate-700 font-bold rounded-sm hover:bg-slate-50 transition-colors">
                              Upload Offline Answers
                            </button>
                          )}
                          
                          {(state === 'closed' || state === 'open') && (
                            <Link 
                              href={`/educator/rounds/${round.id}/marking`}
                              className="inline-flex items-center justify-center px-4 py-2 border border-blue-900 bg-blue-900 text-white font-bold rounded-sm hover:bg-blue-800 transition-colors"
                            >
                              Grade Manual Submissions
                            </Link>
                          )}

                          {state === 'released' && (
                            <Link 
                              href={`/educator/results`}
                              className="inline-flex items-center justify-center px-4 py-2 border border-blue-900 bg-blue-900 text-white font-bold rounded-sm hover:bg-blue-800 transition-colors"
                            >
                              View Results
                            </Link>
                          )}

                          {state === 'scheduled' && (!isPaperOrHybrid || !isPrintWindowOpen) && (
                            <button 
                              disabled
                              className="inline-flex items-center justify-center px-4 py-2 border border-slate-200 bg-slate-100 text-slate-400 font-bold rounded-sm cursor-not-allowed"
                            >
                              Round Not Yet Open
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
          
          {allRounds.length === 0 && (
            <div className="text-center py-12 border border-slate-200 rounded-sm">
              <p className="text-slate-500 mb-0 italic">
                No assessments are currently available for your Olympiads.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
