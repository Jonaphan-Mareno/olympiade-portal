import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { memberships, users, portals, rounds, questionPapers } from '@/lib/db/schema';
import { eq, and, inArray, lt } from 'drizzle-orm';
import Link from 'next/link';

function getOlympiadTitle(portalName: string, roundClosesAt: Date) {
  const year = roundClosesAt.getFullYear().toString();
  // Check if year is already in the portal name
  if (portalName.includes(year)) {
    return portalName;
  }
  return `${portalName} ${year}`;
}

export default async function PastPapersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const [currentUser] = await db.select({ schoolId: users.schoolId }).from(users).where(eq(users.id, user.id));
  const globalSchoolId = currentUser?.schoolId;

  const studentMemberships = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, user.id),
        eq(memberships.role, 'student'),
        globalSchoolId ? eq(memberships.schoolId, globalSchoolId) : undefined
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
  
  const enrolledPortals = await db.select().from(portals).where(inArray(portals.id, portalIds));
  const portalsMap = Object.fromEntries(enrolledPortals.map(p => [p.id, p]));

  const now = new Date();
  
  // Fetch closed rounds
  const pastRounds = await db.select().from(rounds).where(
    and(
      inArray(rounds.portalId, portalIds),
      lt(rounds.closesAt, now)
    )
  ).orderBy(rounds.closesAt);

  const roundIds = pastRounds.map(r => r.id);
  const papers = roundIds.length > 0 ? await db.select().from(questionPapers).where(inArray(questionPapers.roundId, roundIds)) : [];
  const papersMap = Object.fromEntries(papers.map(p => [p.roundId, p]));

  const onlineTests = pastRounds.filter(r => r.deliveryMethod === 'online' || r.deliveryMethod === 'hybrid');
  const offlineTests = pastRounds.filter(r => (r.deliveryMethod === 'paper' || r.deliveryMethod === 'hybrid') && papersMap[r.id]?.fileUrl);

  const { tab } = await searchParams;
  const activeTab = tab === 'offline' ? 'offline' : 'online';

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <div className="bg-blue-950 p-8 md:px-12 text-white mb-8">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-3xl font-bold font-serif mb-2">Past Papers</h1>
          <p className="text-blue-200">Practice with past exams and review official memos.</p>
        </div>
      </div>
      
      <div className="max-w-6xl mx-auto px-4 md:px-8 pb-12">
        <div className="flex border-b border-slate-200 mb-8">
          <Link href="?tab=online" className={`py-3 px-6 font-bold uppercase tracking-wider text-sm border-b-2 ${activeTab === 'online' ? 'border-blue-600 text-blue-800 bg-blue-50/50' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}>
            Online Tests
          </Link>
          <Link href="?tab=offline" className={`py-3 px-6 font-bold uppercase tracking-wider text-sm border-b-2 ${activeTab === 'offline' ? 'border-blue-600 text-blue-800 bg-blue-50/50' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}>
            Offline PDF Tests & Memos
          </Link>
        </div>

        {activeTab === 'online' && (
          <div>
            {onlineTests.length === 0 ? (
              <div className="bg-white p-12 text-center border-2 border-slate-200 text-slate-500 font-medium shadow-sm">
                No past online tests available yet.
              </div>
            ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {onlineTests.map(r => {
                const title = getOlympiadTitle(portalsMap[r.portalId].name, r.closesAt);
                return (
                  <div key={r.id} className="bg-white border-2 border-slate-200 shadow-sm flex flex-col hover:border-blue-300 transition-colors">
                    <div className="bg-slate-50 p-4 border-b-2 border-slate-200">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{r.name}</span>
                      <h3 className="text-lg font-bold text-blue-950 mt-1">{title}</h3>
                    </div>
                    <div className="p-6 flex-1 flex flex-col justify-between">
                      <p className="text-sm text-slate-600 mb-6">
                        Take this test online to practice. It will auto-mark your answers at the end so you can see where you went wrong.
                      </p>
                      <Link 
                        href={`/results/past-papers/${r.id}/practice`}
                        className="block w-full text-center bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-4 rounded transition-colors uppercase tracking-wider text-sm"
                      >
                        Practice Test
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}

        {activeTab === 'offline' && (
          <div>
            {offlineTests.length === 0 ? (
              <div className="bg-white p-12 text-center border-2 border-slate-200 text-slate-500 font-medium shadow-sm">
                No past offline papers available yet.
              </div>
            ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {offlineTests.map(r => {
                const title = getOlympiadTitle(portalsMap[r.portalId].name, r.closesAt);
                const paper = papersMap[r.id];
                const answerKeyObj = (typeof paper.answerKeyJson === 'object' && paper.answerKeyJson !== null) ? paper.answerKeyJson as any : {};
                const memoUrl = answerKeyObj.memoUrl;

                return (
                  <div key={r.id} className="bg-white border-2 border-slate-200 shadow-sm flex flex-col overflow-hidden group hover:border-blue-300 transition-colors">
                    {/* Fake PDF Thumbnail Header */}
                    <div className="h-32 bg-slate-100 border-b-2 border-slate-200 flex items-center justify-center relative overflow-hidden">
                       <div className="absolute top-4 left-4 right-4 bottom-[-20px] bg-white border border-slate-300 shadow-sm rounded-t-sm flex flex-col items-center pt-4 px-4">
                          <div className="w-full max-w-[120px] h-1.5 bg-slate-200 mb-2 rounded-full"></div>
                          <div className="w-full max-w-[160px] h-3 bg-slate-300 mb-4 rounded-full"></div>
                          <div className="w-full h-1 bg-slate-100 mb-1"></div>
                          <div className="w-full h-1 bg-slate-100 mb-1"></div>
                          <div className="w-full h-1 bg-slate-100 mb-1"></div>
                       </div>
                    </div>
                    
                    <div className="p-5 flex-1 flex flex-col">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{r.name}</span>
                      <h3 className="text-lg font-bold text-blue-950 mt-1 mb-6">{title}</h3>
                      
                      <div className="mt-auto space-y-3">
                        {paper.fileUrl && (
                          <a 
                            href={paper.fileUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-2 w-full bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold py-2.5 px-4 rounded border border-slate-300 transition-colors uppercase tracking-wider text-xs"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            Question Paper
                          </a>
                        )}
                        {memoUrl && (
                          <a 
                            href={memoUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-2 w-full bg-amber-50 hover:bg-amber-100 text-amber-900 font-bold py-2.5 px-4 rounded border border-amber-300 transition-colors uppercase tracking-wider text-xs"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Download Memo
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}

      </div>
    </div>
  );
}
