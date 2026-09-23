import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { memberships, rounds, submissions, results, users, portals } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { deriveRoundState } from '@/domain/rounds/round-state-machine';

export const dynamic = 'force-dynamic';

export default async function EducatorResultsPage() {
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

  const roundIds = completedRounds.map(r => r.id);

  let rankedDataByRound = new Map();

  if (roundIds.length > 0) {
    // Fetch submissions + results + student users across the entire portal for these rounds
    // We join memberships to get the student's schoolId and name
    const portalSubmissions = await db
      .select({
        submissionId: submissions.id,
        roundId: submissions.roundId,
        score: results.score,
        studentSchoolId: memberships.schoolId,
        studentName: users.name,
        invitedEmail: memberships.invitedEmail,
      })
      .from(submissions)
      .innerJoin(results, eq(submissions.id, results.submissionId))
      .innerJoin(memberships, eq(submissions.studentMembershipId, memberships.id))
      .leftJoin(users, eq(memberships.userId, users.id))
      .where(inArray(submissions.roundId, roundIds));

    // Calculate global rank per round
    for (const round of completedRounds) {
      const subsForRound = portalSubmissions.filter(s => s.roundId === round.id);
      
      // Sort by score DESC
      subsForRound.sort((a, b) => {
        const scoreA = parseFloat(a.score as string) || 0;
        const scoreB = parseFloat(b.score as string) || 0;
        return scoreB - scoreA;
      });

      // Assign ranks (handle ties)
      let currentRank = 1;
      let lastScore = -1;
      let itemsAtCurrentScore = 0;

      const rankedSubs = subsForRound.map((sub, index) => {
        const score = parseFloat(sub.score as string) || 0;
        if (score === lastScore) {
          itemsAtCurrentScore++;
        } else {
          currentRank = index + 1;
          lastScore = score;
          itemsAtCurrentScore = 1;
        }
        return {
          ...sub,
          rank: currentRank,
        };
      });

      // Filter to only include students from this educator's school
      const schoolRankedSubs = rankedSubs.filter(s => s.studentSchoolId === schoolId);
      
      rankedDataByRound.set(round.id, schoolRankedSubs);
    }
  }

  return (
    <div className="min-h-screen bg-white font-sans w-full px-4 md:px-8 pt-10 pb-20">
      <div className="max-w-4xl mx-auto">
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
                <h2 className="font-serif text-2xl font-bold text-slate-800 border-b border-slate-200 pb-3">{portal.name}</h2>
                
                {portalRounds.map((round) => {
                  const students = rankedDataByRound.get(round.id) || [];
                  
                  return (
                    <div key={round.id} className="flex flex-col border border-slate-200 rounded-md overflow-hidden">
                      <div className="flex flex-row justify-between items-center bg-blue-900 p-4 px-6">
                        <h3 className="font-serif text-xl font-bold text-white m-0">
                          Round {round.orderIndex}: {round.name}
                        </h3>
                        <span className="text-blue-200 text-sm">
                          {deriveRoundState(round, now) === 'released' ? 'Results Released' : 'Grading in Progress'}
                        </span>
                      </div>

                      <div className="bg-white">
                        {students.length === 0 ? (
                          <div className="p-8 text-center border-t border-slate-200">
                            <p className="text-slate-500 italic mb-0">No students from your school submitted for this round.</p>
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                              <thead>
                                <tr className="bg-slate-50 border-b border-slate-200">
                                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Rank (Global)</th>
                                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Student Name</th>
                                  <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Final Score</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {students.map((student: any) => (
                                  <tr key={student.submissionId} className="hover:bg-slate-50/50 transition-colors">
                                    <td className="px-6 py-4">
                                      <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-50 text-blue-700 font-bold text-sm">
                                        #{student.rank}
                                      </span>
                                    </td>
                                    <td className="px-6 py-4">
                                      <div className="font-medium text-slate-900">{student.studentName || student.invitedEmail}</div>
                                      {!student.studentName && <div className="text-xs text-slate-400">Name not set</div>}
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                      <span className="font-bold text-slate-900">{student.score}</span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
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
