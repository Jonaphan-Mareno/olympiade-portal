import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { memberships, rounds, submissions, results, users, portals, schools, questions } from '@/lib/db/schema';
import { eq, and, inArray, desc, isNotNull } from 'drizzle-orm';
import { deriveRoundState } from '@/domain/rounds/round-state-machine';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function EducatorResultsPage({
  searchParams
}: {
  searchParams: Promise<{ roundId?: string; view?: string }>
}) {
  const resolvedSearchParams = await searchParams;
  const currentRoundId = resolvedSearchParams.roundId;
  const activeView = resolvedSearchParams.view || 'school';
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
  
  const schoolId = activeSchoolMemberships[0].schoolId;
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
  
  // Filter for completed rounds (closed or released)
  const completedRounds = allRounds.filter((r) => {
    const state = deriveRoundState(r, now);
    return state === 'closed' || state === 'released';
  });

  const activeRoundId = currentRoundId || (completedRounds.length > 0 ? completedRounds[0].id : undefined);

  const roundIds = completedRounds.map(r => r.id);

  let rankedDataByRound = new Map();
  let globalDataByRound = new Map();

  if (roundIds.length > 0) {
    const portalSubmissions = await db
      .select({
        submissionId: submissions.id,
        roundId: submissions.roundId,
        score: results.score,
        studentSchoolId: memberships.schoolId,
        studentName: users.name,
        invitedEmail: memberships.invitedEmail,
        schoolName: schools.name,
      })
      .from(submissions)
      .innerJoin(results, eq(submissions.id, results.submissionId))
      .innerJoin(memberships, eq(submissions.studentMembershipId, memberships.id))
      .leftJoin(users, eq(memberships.userId, users.id))
      .leftJoin(schools, eq(memberships.schoolId, schools.id))
      .where(inArray(submissions.roundId, roundIds));
      
    const roundQuestions = await db
      .select({ roundId: questions.roundId, marks: questions.marks })
      .from(questions)
      .where(inArray(questions.roundId, roundIds));

    for (const round of completedRounds) {
      const subsForRound = portalSubmissions.filter(s => s.roundId === round.id);
      
      const qForRound = roundQuestions.filter(q => q.roundId === round.id);
      const totalMarks = qForRound.reduce((sum, q) => sum + (q.marks || 0), 0) || 100;
      
      subsForRound.sort((a, b) => {
        const scoreA = parseFloat(a.score as string) || 0;
        const scoreB = parseFloat(b.score as string) || 0;
        return scoreB - scoreA;
      });

      let currentRank = 1;
      let lastScore = -1;
      let itemsAtCurrentScore = 0;

      const rankedSubs = subsForRound.map((sub, index) => {
        const numericScore = parseFloat(sub.score as string) || 0;
        if (numericScore === lastScore) {
          itemsAtCurrentScore++;
        } else {
          currentRank = index + 1;
          lastScore = numericScore;
          itemsAtCurrentScore = 1;
        }
        return {
          ...sub,
          rank: currentRank,
          numericScore,
          percentage: ((numericScore / totalMarks) * 100).toFixed(1),
        };
      });

      const schoolRankedSubs = rankedSubs.filter(s => s.studentSchoolId === schoolId);
      
      // recalculate internal rank
      let currentInternalRank = 1;
      let lastInternalScore = -1;
      let itemsAtInternalCurrentScore = 0;
      schoolRankedSubs.forEach((sub, index) => {
        if (sub.numericScore === lastInternalScore) {
          itemsAtInternalCurrentScore++;
        } else {
          currentInternalRank = index + 1;
          lastInternalScore = sub.numericScore;
          itemsAtInternalCurrentScore = 1;
        }
        sub.internalRank = currentInternalRank;
      });

      rankedDataByRound.set(round.id, schoolRankedSubs);
      globalDataByRound.set(round.id, rankedSubs.slice(0, 50));
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans w-full px-4 md:px-8 pt-10 pb-20">
      <div className="max-w-6xl mx-auto">
        <h1 className="font-serif text-3xl font-bold text-slate-900 mb-8">
          Results & Standings
        </h1>

        <div className="flex flex-col gap-12">
          {portalRows.map(portal => {
            const portalRounds = completedRounds.filter(r => r.portalId === portal.id);
            
            if (portalRounds.length === 0) {
              return null;
            }

            return (
              <div key={portal.id} className="flex flex-col gap-6">
                <h2 className="font-serif text-2xl font-bold text-slate-800 pb-2">{portal.name}</h2>
                
                <div className="flex gap-6 border-b border-slate-200">
                  {portalRounds.map(round => {
                    const isActive = activeRoundId ? round.id === activeRoundId : round.id === portalRounds[0].id;
                    return (
                      <Link
                        key={round.id}
                        href={`?roundId=${round.id}&view=${activeView}`}
                        className={`pb-3 text-sm font-bold uppercase tracking-wider transition-colors border-b-2 ${
                          isActive 
                            ? 'border-blue-950 text-blue-950' 
                            : 'border-transparent text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        Round {round.orderIndex}: {round.name}
                      </Link>
                    );
                  })}
                </div>

                <div className="bg-white border-2 border-slate-200 shadow-sm rounded-none overflow-hidden">
                  {(() => {
                    const activeRoundForPortal = portalRounds.find(r => r.id === activeRoundId) || portalRounds[0];
                    const students = rankedDataByRound.get(activeRoundForPortal.id) || [];
                    const globalTop50 = globalDataByRound.get(activeRoundForPortal.id) || [];
                    
                    return (
                      <div className="flex flex-col">
                        <div className="flex border-b-2 border-slate-200">
                          <Link
                            href={`?roundId=${activeRoundForPortal.id}&view=school`}
                            className={`flex-1 py-4 text-center font-bold text-sm uppercase tracking-wider transition-colors border-b-4 -mb-[2px] ${
                              activeView === 'school'
                                ? 'border-blue-950 text-blue-950 bg-blue-50/30'
                                : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            School Roster
                          </Link>
                          <Link
                            href={`?roundId=${activeRoundForPortal.id}&view=global`}
                            className={`flex-1 py-4 text-center font-bold text-sm uppercase tracking-wider transition-colors border-b-4 -mb-[2px] ${
                              activeView === 'global'
                                ? 'border-blue-950 text-blue-950 bg-blue-50/30'
                                : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            Global Top 50 Leaderboard
                          </Link>
                        </div>
                        
                        {activeView === 'school' && (
                          students.length === 0 ? (
                            <div className="p-8 text-center">
                              <p className="text-slate-500 font-medium mb-0">No students from your school submitted for this round.</p>
                            </div>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-left border-collapse">
                                <thead>
                                  <tr className="bg-slate-50 border-b-2 border-slate-200">
                                    <th className="px-6 py-4 text-xs font-bold text-blue-950 uppercase tracking-wider w-24 text-center">Rank</th>
                                    <th className="px-6 py-4 text-xs font-bold text-blue-950 uppercase tracking-wider">Student Name</th>
                                    <th className="px-6 py-4 text-xs font-bold text-blue-950 uppercase tracking-wider text-right">Raw Score</th>
                                    <th className="px-6 py-4 text-xs font-bold text-blue-950 uppercase tracking-wider text-right">Percentage</th>
                                    <th className="px-6 py-4 text-xs font-bold text-blue-950 uppercase tracking-wider text-center">Certificate</th>
                                    <th className="px-6 py-4 text-xs font-bold text-blue-950 uppercase tracking-wider text-right">Action</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {students.map((student: any) => (
                                    <tr key={student.submissionId} className="hover:bg-slate-50 transition-colors">
                                      <td className="px-6 py-4 text-center">
                                        <span className="font-bold text-blue-950 text-lg">
                                          #{student.internalRank}
                                        </span>
                                      </td>
                                      <td className="px-6 py-4">
                                        <div className="font-bold text-slate-900">{student.studentName || student.invitedEmail}</div>
                                        {!student.studentName && <div className="text-xs font-medium text-slate-400">Name pending</div>}
                                      </td>
                                      <td className="px-6 py-4 text-right">
                                        <span className="font-bold text-slate-700">{student.numericScore}</span>
                                      </td>
                                      <td className="px-6 py-4 text-right">
                                        <span className="font-bold text-slate-900">{student.percentage}%</span>
                                      </td>
                                      <td className="px-6 py-4 text-center">
                                        <a 
                                          href={`/api/certificates/${student.submissionId}`}
                                          className="text-blue-600 hover:text-blue-800 font-bold text-xs uppercase tracking-wider transition-colors inline-block" 
                                          download
                                        >
                                          Download &darr;
                                        </a>
                                      </td>
                                      <td className="px-6 py-4 text-right">
                                        <Link
                                          href={`/educator/results/${student.submissionId}`}
                                          className="text-blue-600 hover:text-blue-800 font-bold text-xs uppercase tracking-wider transition-colors"
                                        >
                                          View Paper &rarr;
                                        </Link>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )
                        )}

                        {activeView === 'global' && (
                          globalTop50.length === 0 ? (
                            <div className="p-8 text-center">
                              <p className="text-slate-500 font-medium mb-0">No graded submissions found globally yet.</p>
                            </div>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-left border-collapse">
                                <thead>
                                  <tr className="bg-slate-50 border-b-2 border-slate-200">
                                    <th className="px-6 py-4 text-xs font-bold text-blue-950 uppercase tracking-wider w-24 text-center">Global Rank</th>
                                    <th className="px-6 py-4 text-xs font-bold text-blue-950 uppercase tracking-wider">Student Name</th>
                                    <th className="px-6 py-4 text-xs font-bold text-blue-950 uppercase tracking-wider">School</th>
                                    <th className="px-6 py-4 text-xs font-bold text-blue-950 uppercase tracking-wider text-right">Final Score</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {globalTop50.map((student: any) => (
                                    <tr key={student.submissionId} className={`hover:bg-slate-50 transition-colors ${student.studentSchoolId === schoolId ? 'bg-blue-50/30' : ''}`}>
                                      <td className="px-6 py-4 text-center">
                                        <span className="font-bold text-blue-950 text-lg">
                                          #{student.rank}
                                        </span>
                                      </td>
                                      <td className="px-6 py-4">
                                        <div className="font-bold text-slate-900">
                                          {student.studentName || student.invitedEmail.split('@')[0] + '***'}
                                        </div>
                                      </td>
                                      <td className="px-6 py-4">
                                        <span className="font-medium text-slate-600 uppercase tracking-wide text-xs">{student.schoolName}</span>
                                      </td>
                                      <td className="px-6 py-4 text-right">
                                        <span className="font-bold text-slate-900 text-lg">{student.percentage}%</span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })}
          
          {completedRounds.length === 0 && (
            <div className="text-center py-12 border border-dashed border-slate-300 rounded-lg">
              <p className="text-slate-500 mb-0 italic">
                No rounds have been completed yet. Results will appear here when they are ready.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
