import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import {
  memberships,
  portals,
  rounds,
  schools,
  examSittings,
  questionPapers,
  submissions,
  results as resultsTable,
  users
} from '@/lib/db/schema';
import { eq, and, inArray, isNotNull, desc } from 'drizzle-orm';
import { deriveRoundState } from '@/domain/rounds/round-state-machine';
import HeroBanner from '@/components/ui/HeroBanner';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function StudentGlobalOverviewPage() {
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
      and(
        eq(memberships.userId, user.id),
        eq(memberships.role, 'student')
      )
    );

  if (studentMemberships.length === 0) {
    redirect('/dashboard');
  }

  const portalIds = [...new Set(studentMemberships.map(m => m.portalId))];
  const membershipIds = studentMemberships.map(m => m.id);

  const [portalRows, allRounds, studentSubmissions] = await Promise.all([
    portalIds.length > 0 ? db.select().from(portals).where(inArray(portals.id, portalIds)) : [],
    portalIds.length > 0 ? db.select().from(rounds).where(inArray(rounds.portalId, portalIds)) : [],
    membershipIds.length > 0 ? db
      .select({
        submissionId: submissions.id,
        roundId: submissions.roundId,
        score: resultsTable.score,
        status: submissions.status,
      })
      .from(submissions)
      .leftJoin(resultsTable, eq(resultsTable.submissionId, submissions.id))
      .where(inArray(submissions.studentMembershipId, membershipIds)) : []
  ]);

  const portalMap = new Map(portalRows.map(p => [p.id, p]));
  const roundMap = new Map(allRounds.map(r => [r.id, r]));

  const now = new Date();
  const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // 1. Action Zone calculation
  let urgentRound: any = null;
  let urgentRoundState = null;
  let isActionable = false;
  let urgentPortal = null;
  
  // Find the most urgent round (Open or opening within 24h)
  const sortedRounds = allRounds
    .filter(r => {
      const state = deriveRoundState(r, now);
      if (state === 'open') return true;
      if (state === 'scheduled' && r.opensAt <= next24h) return true;
      return false;
    })
    .sort((a, b) => {
       const stateA = deriveRoundState(a, now);
       const stateB = deriveRoundState(b, now);
       if (stateA === 'open' && stateB !== 'open') return -1;
       if (stateB === 'open' && stateA !== 'open') return 1;
       if (stateA === 'open') return a.closesAt.getTime() - b.closesAt.getTime();
       return a.opensAt.getTime() - b.opensAt.getTime();
    });

  if (sortedRounds.length > 0) {
    urgentRound = sortedRounds[0];
    urgentRoundState = deriveRoundState(urgentRound, now);
    urgentPortal = portalMap.get(urgentRound.portalId);
    
    if (urgentRoundState === 'open' && urgentRound.deliveryMethod !== 'paper') {
      // Check if already taken
      const m = studentMemberships.find(sm => sm.portalId === urgentRound.portalId);
      if (m) {
        const paper = await db.select().from(questionPapers).where(eq(questionPapers.roundId, urgentRound.id)).limit(1);
        if (paper.length > 0) {
          const sittings = await db.select().from(examSittings).where(
            and(
              eq(examSittings.studentMembershipId, m.id),
              eq(examSittings.questionPaperId, paper[0].id)
            )
          );
          if (!sittings.some(s => s.status === 'submitted' || s.status === 'abandoned')) {
            isActionable = true;
          }
        } else {
          isActionable = true; // No paper yet, but still "open" theoretically
        }
      }
    }
  }

  // 2. Stats calculation
  const totalOlympiads = portalIds.length;
  const roundsCompleted = studentSubmissions.filter(s => s.status === 'submitted').length;
  const certificates = 0; // Mocked

  let recentAchievement: any = null;
  const completedWithResults = studentSubmissions
    .filter(s => s.score !== null && s.status === 'submitted')
    .map(s => {
       const r = roundMap.get(s.roundId);
       return { ...s, round: r, publishedAt: r?.resultsPublishedAt };
    })
    .filter(s => s.publishedAt && s.publishedAt <= now)
    .sort((a, b) => b.publishedAt!.getTime() - a.publishedAt!.getTime());

  if (completedWithResults.length > 0) {
    recentAchievement = completedWithResults[0];
    
    // Calculate ranking
    const allRoundResults = await db.select({
      score: resultsTable.score
    }).from(resultsTable)
      .innerJoin(submissions, eq(resultsTable.submissionId, submissions.id))
      .where(eq(submissions.roundId, recentAchievement.roundId));

    const scores = allRoundResults
      .map(r => parseFloat(r.score as string) || 0)
      .sort((a, b) => b - a);

    const studentScore = parseFloat(recentAchievement.score) || 0;
    const rank = scores.indexOf(studentScore) + 1;
    recentAchievement.rank = rank;
    recentAchievement.totalStudents = scores.length;
  }

  const pendingSubmissions = studentSubmissions
    .filter(s => s.status === 'submitted')
    .map(s => {
       const r = roundMap.get(s.roundId);
       return { ...s, round: r, publishedAt: r?.resultsPublishedAt };
    })
    .filter(s => !s.publishedAt || s.publishedAt > now)
    .sort((a, b) => (b.submittedAt?.getTime() || 0) - (a.submittedAt?.getTime() || 0));

  const latestPending = pendingSubmissions.length > 0 ? pendingSubmissions[0] : null;

  const displayName = user.user_metadata?.full_name || user.email;
  const firstName = displayName?.split(' ')[0] || 'Student';
  const initial = (user.user_metadata?.full_name?.charAt(0) || user.email?.charAt(0) || '?').toUpperCase();

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <HeroBanner
        userName={firstName}
        userInitial={initial}
        subtitle="Welcome to your action center."
      />
      
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-8">
        
        {/* Action Zone Banner */}
        {urgentRound && (
          <div className="bg-white border-2 border-blue-950 rounded-none shadow-sm overflow-hidden flex flex-col md:flex-row">
            <div className="bg-blue-950 text-white p-6 md:w-1/3 flex flex-col justify-center">
              <span className="text-amber-400 font-bold text-xs uppercase tracking-widest mb-2">
                {urgentRoundState === 'open' ? 'Active Now' : 'Opening Soon'}
              </span>
              <h2 className="text-2xl md:text-3xl font-serif font-bold leading-tight mb-2">
                {urgentRound.name}
              </h2>
              <p className="text-blue-200 text-sm">{urgentPortal?.name}</p>
            </div>
            
            <div className="p-6 md:p-8 md:w-2/3 flex flex-col md:flex-row md:items-center justify-between gap-6 bg-white">
              <div>
                <p className="text-slate-500 font-bold text-sm uppercase tracking-wider mb-1">
                  {urgentRoundState === 'open' ? 'Time Remaining' : 'Countdown to Start'}
                </p>
                <p className="text-3xl font-bold text-slate-900">
                  {/* Since I don't have a ClientCountdown component guaranteed, I'll just render the date nicely */}
                  {urgentRoundState === 'open' 
                    ? `Closes ${new Date(urgentRound.closesAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}`
                    : `Opens ${new Date(urgentRound.opensAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}`
                  }
                </p>
                {urgentRound.deliveryMethod === 'paper' && urgentRoundState === 'open' && (
                  <p className="text-amber-600 font-medium text-sm mt-2">
                    Paper round: Please ask your teacher for your exam paper.
                  </p>
                )}
              </div>
              
              {isActionable && (
                <Link 
                  href={`/results/${urgentRound.portalId}/rounds`}
                  className="bg-amber-400 hover:bg-amber-500 text-amber-950 font-bold py-4 px-10 transition-colors text-center text-sm uppercase tracking-wider rounded-none border-2 border-amber-500 shrink-0"
                >
                  Start Test
                </Link>
              )}
            </div>
          </div>
        )}

        {/* At-a-Glance Stats */}
        <div>
          <h2 className="font-serif text-2xl text-blue-950 font-bold mb-4">
            At a Glance
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white border-2 border-slate-200 rounded-none p-6 flex flex-col justify-center">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Total Olympiads</span>
              <span className="text-4xl font-bold text-blue-950">{totalOlympiads}</span>
            </div>
            <div className="bg-white border-2 border-slate-200 rounded-none p-6 flex flex-col justify-center">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Rounds Completed</span>
              <span className="text-4xl font-bold text-blue-950">{roundsCompleted}</span>
            </div>
            <div className="bg-white border-2 border-slate-200 rounded-none p-6 flex flex-col justify-center">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Certificates</span>
              <span className="text-4xl font-bold text-blue-950">{certificates}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Recent Achievements */}
          {recentAchievement ? (
            <div>
              <h2 className="font-serif text-2xl text-blue-950 font-bold mb-4">
                Recent Achievement
              </h2>
              <div className="bg-blue-950 border-2 border-blue-950 rounded-none p-6 h-full flex flex-col justify-center relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                  <svg width="120" height="120" viewBox="0 0 24 24" fill="currentColor" className="text-white">
                    <path d="M12 15.228l-5.32 2.796 1.017-5.928L3.385 7.89l5.952-.866L12 1.636l2.663 5.388 5.952.866-4.312 4.206 1.017 5.928z"/>
                  </svg>
                </div>
                <div className="relative z-10 flex flex-row justify-between items-end">
                  <div>
                    <span className="text-amber-400 font-bold text-xs uppercase tracking-widest mb-2 block">
                      Latest Result
                    </span>
                    <p className="text-white text-4xl font-bold mb-1">
                      {recentAchievement.score}%
                    </p>
                    <p className="text-slate-300 font-medium">
                      in {recentAchievement.round?.name || 'Round'}
                    </p>
                    <div className="flex gap-4 mt-4">
                      <Link href={`/results/scores`} className="inline-block text-amber-400 hover:text-amber-300 font-bold text-sm uppercase tracking-wider">
                        View all results &rarr;
                      </Link>
                      <a href={`/api/certificates/${recentAchievement.submissionId}`} download className="inline-block text-white hover:text-blue-200 font-bold text-sm uppercase tracking-wider">
                        Download Certificate &darr;
                      </a>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-blue-300 font-bold text-xs uppercase tracking-widest mb-1 block">
                      Ranking
                    </span>
                    <p className="text-white text-2xl font-bold">
                      #{recentAchievement.rank} <span className="text-sm text-slate-400 font-normal">/ {recentAchievement.totalStudents}</span>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : latestPending ? (
            <div>
              <h2 className="font-serif text-2xl text-blue-950 font-bold mb-4">
                Recent Achievement
              </h2>
              <div className="bg-slate-50 border-2 border-slate-200 rounded-none p-6 h-full flex flex-col justify-center">
                <span className="text-slate-500 font-bold text-xs uppercase tracking-widest mb-2 block">
                  Awaiting Marker
                </span>
                <p className="text-slate-900 text-xl font-bold mb-2">
                  {latestPending.round?.name || 'Round'}
                </p>
                <p className="text-slate-600 font-medium text-sm">
                  Your marks are currently being processed by your educator and will appear here once published.
                </p>
              </div>
            </div>
          ) : null}

          {/* Quick Prep */}
          <div className={(!recentAchievement && !latestPending) ? "md:col-span-2" : ""}>
            <h2 className="font-serif text-2xl text-blue-950 font-bold mb-4">
              Quick Prep
            </h2>
            <div className="bg-blue-50 border-2 border-blue-200 rounded-none p-6 h-full flex flex-col justify-center">
              <span className="text-blue-800 font-bold text-xs uppercase tracking-widest mb-2 block">
                Practice
              </span>
              <h3 className="text-xl font-bold text-blue-950 mb-2">
                Prepare for your next round
              </h3>
              <p className="text-blue-800 mb-6">
                Access past papers to sharpen your skills before the actual exam.
              </p>
              <div>
                <Link href="/results/past-papers" className="inline-block bg-white border-2 border-blue-950 text-blue-950 font-bold py-2.5 px-6 hover:bg-blue-950 hover:text-white transition-colors text-sm uppercase tracking-wider rounded-none">
                  Browse Past Papers
                </Link>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
