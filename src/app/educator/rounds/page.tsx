import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { memberships, rounds, portals, questionPapers } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { deriveRoundState } from '@/domain/rounds/round-state-machine';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function EducatorAssessmentsPage(props: { searchParams: Promise<{ tab?: string }> }) {
  const searchParams = await props.searchParams;
  const activeTab = searchParams.tab === 'offline' ? 'offline' : 'online';

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

  const roundIds = allRounds.map(r => r.id);

  const allPapers = roundIds.length > 0 
    ? await db.select().from(questionPapers).where(inArray(questionPapers.roundId, roundIds))
    : [];

  const now = new Date();

  return (
    <div className="min-h-screen bg-white font-sans w-full px-4 md:px-8 pt-10 pb-20">
      <div className="max-w-4xl mx-auto">
        <h1 className="font-serif text-3xl font-bold text-slate-900 mb-4">
          Assessments
        </h1>
        <p className="text-slate-600 mb-8">
          Command center for downloading papers and grading submissions.
        </p>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 mb-8">
          <Link 
            href="/educator/rounds?tab=online"
            className={`px-6 py-3 font-bold uppercase tracking-wider text-sm transition-colors border-b-2 ${
              activeTab === 'online' 
                ? 'border-blue-900 text-blue-900' 
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Online Submissions
          </Link>
          <Link 
            href="/educator/rounds?tab=offline"
            className={`px-6 py-3 font-bold uppercase tracking-wider text-sm transition-colors border-b-2 ${
              activeTab === 'offline' 
                ? 'border-blue-900 text-blue-900' 
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Physical Papers
          </Link>
        </div>

        <div className="flex flex-col gap-12">
          {portalRows.map(portal => {
            let portalRounds = allRounds.filter(r => r.portalId === portal.id);
            
            if (activeTab === 'online') {
               portalRounds = portalRounds.filter(r => r.deliveryMethod === 'online' || r.deliveryMethod === 'hybrid');
            } else {
               portalRounds = portalRounds.filter(r => r.deliveryMethod === 'paper' || r.deliveryMethod === 'hybrid');
            }
            
            if (portalRounds.length === 0) {
              return null;
            }

            return (
              <div key={portal.id} className="flex flex-col gap-6">
                <h2 className="font-serif text-2xl font-bold text-slate-800 border-b border-slate-200 pb-3">{portal.name}</h2>
                
                {portalRounds.map((round) => {
                  const state = deriveRoundState(round, now);
                  
                  // Offline grading window logic
                  const offlineGradingClosesAt = new Date(round.closesAt.getTime() + 24 * 60 * 60 * 1000);
                  const isWithinOfflineGradingWindow = now >= round.opensAt && now <= offlineGradingClosesAt;

                  const paper = allPapers.find(p => p.roundId === round.id);

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
                          {activeTab === 'offline' && (
                            <>
                              {(state === 'open' || state === 'closed' || state === 'released') && (
                                <>
                                  {paper?.fileUrl ? (
                                    <a
                                      href={paper.fileUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center justify-center px-4 py-2 border border-slate-300 bg-white text-slate-700 font-bold rounded-sm hover:bg-slate-50 transition-colors"
                                    >
                                      Download Question Paper
                                    </a>
                                  ) : (
                                    <button 
                                      disabled
                                      className="inline-flex items-center justify-center px-4 py-2 border border-slate-200 bg-slate-100 text-slate-400 font-bold rounded-sm cursor-not-allowed"
                                    >
                                      No Paper Uploaded
                                    </button>
                                  )}

                                  {isWithinOfflineGradingWindow ? (
                                    <Link 
                                      href={`/educator/rounds/${round.id}/offline-marks`}
                                      className="inline-flex items-center justify-center px-4 py-2 border border-blue-900 bg-blue-900 text-white font-bold rounded-sm hover:bg-blue-800 transition-colors"
                                    >
                                      Enter Offline Marks
                                    </Link>
                                  ) : (
                                    <button 
                                      disabled
                                      className="inline-flex items-center justify-center px-4 py-2 border border-slate-200 bg-slate-100 text-slate-400 font-bold rounded-sm cursor-not-allowed"
                                      title={now > offlineGradingClosesAt ? 'The 24-hour grading window has closed' : 'Grading has not opened yet'}
                                    >
                                      <span className="mr-2">🔒</span>
                                      Enter Offline Marks
                                    </button>
                                  )}
                                </>
                              )}

                              {state === 'scheduled' && (
                                <button 
                                  disabled
                                  className="inline-flex items-center justify-center px-4 py-2 border border-slate-200 bg-slate-100 text-slate-400 font-bold rounded-sm cursor-not-allowed"
                                >
                                  Round Not Yet Open
                                </button>
                              )}
                            </>
                          )}

                          {activeTab === 'online' && (
                            <>
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

                              {state === 'scheduled' && (
                                <button 
                                  disabled
                                  className="inline-flex items-center justify-center px-4 py-2 border border-slate-200 bg-slate-100 text-slate-400 font-bold rounded-sm cursor-not-allowed"
                                >
                                  Round Not Yet Open
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
          
          {!portalRows.some(portal => {
            const portalRounds = allRounds.filter(r => r.portalId === portal.id);
            if (activeTab === 'online') {
               return portalRounds.some(r => r.deliveryMethod === 'online' || r.deliveryMethod === 'hybrid');
            } else {
               return portalRounds.some(r => r.deliveryMethod === 'paper' || r.deliveryMethod === 'hybrid');
            }
          }) && (
            <div className="text-center py-12 border border-slate-200 rounded-sm">
              <p className="text-slate-500 mb-0 italic">
                No assessments are currently available for your Olympiads in this category.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
