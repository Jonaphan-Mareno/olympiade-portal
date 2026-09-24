import { db } from '@/lib/db';
import {
  rounds,
  submissions,
  results,
  users,
  memberships,
  schools,
  questions,
} from '@/lib/db/schema';
import { eq, and, isNotNull, desc } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function EducatorStandingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ roundId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { roundId } = await params;
  const resolvedSearchParams = await searchParams;
  const tab = resolvedSearchParams.tab || 'school';

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const [round] = await db.select().from(rounds).where(eq(rounds.id, roundId));
  if (!round) return <div>Round not found</div>;

  const educatorMemberships = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), eq(memberships.role, 'educator')));

  if (educatorMemberships.length === 0) redirect('/dashboard');

  const cookieStore = await cookies();
  const activeSchoolId = cookieStore.get('active_school_id')?.value;

  const activeSchoolMemberships = activeSchoolId 
    ? educatorMemberships.filter((m) => m.schoolId === activeSchoolId)
    : educatorMemberships.filter(m => m.schoolId === educatorMemberships[0].schoolId);

  if (activeSchoolMemberships.length === 0 || !activeSchoolMemberships[0].schoolId) {
    return <div>No school assigned.</div>;
  }
  
  const schoolId = activeSchoolMemberships[0].schoolId;

  // Calculate total possible marks
  const roundQuestions = await db
    .select({ marks: questions.marks })
    .from(questions)
    .where(eq(questions.roundId, roundId));
    
  const totalMarks = roundQuestions.reduce((sum, q) => sum + (q.marks || 0), 0) || 100; // fallback to 100

  // 1. School Roster Query
  let schoolRoster: any[] = [];
  if (tab === 'school') {
    const rawRoster = await db
      .select({
        submissionId: submissions.id,
        score: results.score,
        studentName: users.name,
        invitedEmail: memberships.invitedEmail,
      })
      .from(submissions)
      .innerJoin(results, eq(submissions.id, results.submissionId))
      .innerJoin(memberships, eq(submissions.studentMembershipId, memberships.id))
      .leftJoin(users, eq(memberships.userId, users.id))
      .where(
        and(
          eq(submissions.roundId, roundId),
          eq(memberships.schoolId, schoolId),
          isNotNull(results.score)
        )
      )
      .orderBy(desc(results.score));

    // Calculate ranks and percentages
    let currentRank = 1;
    let lastScore = -1;
    let itemsAtCurrentScore = 0;

    schoolRoster = rawRoster.map((row, index) => {
      const numericScore = parseFloat(row.score as string) || 0;
      if (numericScore === lastScore) {
        itemsAtCurrentScore++;
      } else {
        currentRank = index + 1;
        lastScore = numericScore;
        itemsAtCurrentScore = 1;
      }
      return {
        ...row,
        numericScore,
        percentage: ((numericScore / totalMarks) * 100).toFixed(1),
        rank: currentRank,
      };
    });
  }

  // 2. Global Top 50 Query
  let globalTop50: any[] = [];
  if (tab === 'global') {
    const rawGlobal = await db
      .select({
        submissionId: submissions.id,
        score: results.score,
        studentName: users.name,
        invitedEmail: memberships.invitedEmail,
        schoolName: schools.name,
      })
      .from(submissions)
      .innerJoin(results, eq(submissions.id, results.submissionId))
      .innerJoin(memberships, eq(submissions.studentMembershipId, memberships.id))
      .innerJoin(schools, eq(memberships.schoolId, schools.id))
      .leftJoin(users, eq(memberships.userId, users.id))
      .where(
        and(
          eq(submissions.roundId, roundId),
          isNotNull(results.score)
        )
      )
      .orderBy(desc(results.score))
      .limit(50);

    let currentRank = 1;
    let lastScore = -1;
    let itemsAtCurrentScore = 0;

    globalTop50 = rawGlobal.map((row, index) => {
      const numericScore = parseFloat(row.score as string) || 0;
      if (numericScore === lastScore) {
        itemsAtCurrentScore++;
      } else {
        currentRank = index + 1;
        lastScore = numericScore;
        itemsAtCurrentScore = 1;
      }
      return {
        ...row,
        numericScore,
        percentage: ((numericScore / totalMarks) * 100).toFixed(1),
        rank: currentRank,
        isOwnSchool: false, // Could flag students from their own school
      };
    });
  }

  return (
    <div className="min-h-screen bg-white font-sans w-full px-4 md:px-8 pt-10 pb-20">
      <div className="max-w-6xl mx-auto">
        <Link
          href={`/educator/rounds/${roundId}/marking`}
          className="text-blue-600 hover:text-blue-800 font-medium mb-6 inline-block"
        >
          &larr; Back to Round Marking
        </Link>
        <h1 className="font-serif text-3xl font-bold text-slate-900 mb-2">
          Standings: {round.name}
        </h1>
        <p className="text-slate-600 mb-8">
          View detailed performance metrics and rankings for this specific round.
        </p>

        <div className="mb-6 flex gap-1 border-b border-slate-300">
          <Link
            href={`?tab=school`}
            className={`pb-3 px-4 font-bold text-sm uppercase tracking-wider transition-colors ${
              tab === 'school'
                ? 'border-b-4 border-slate-900 text-slate-900 bg-slate-50'
                : 'border-b-4 border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}
          >
            School Roster
          </Link>
          <Link
            href={`?tab=global`}
            className={`pb-3 px-4 font-bold text-sm uppercase tracking-wider transition-colors ${
              tab === 'global'
                ? 'border-b-4 border-slate-900 text-slate-900 bg-slate-50'
                : 'border-b-4 border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}
          >
            Global Top 50
          </Link>
        </div>

        {tab === 'school' && (
          <div className="bg-white border-2 border-slate-900 rounded-none overflow-hidden shadow-[4px_4px_0px_0px_rgba(15,23,42,1)]">
            <div className="bg-slate-900 text-white p-4">
              <h2 className="text-xl font-bold uppercase tracking-wider">Internal Roster</h2>
            </div>
            {schoolRoster.length === 0 ? (
              <div className="p-8 text-center text-slate-500 font-medium">
                No graded submissions found for your school yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-100 border-b-2 border-slate-900">
                      <th className="px-6 py-4 text-xs font-bold text-slate-900 uppercase tracking-wider border-r-2 border-slate-900 w-24 text-center">Rank</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-900 uppercase tracking-wider border-r-2 border-slate-900">Student Name</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-900 uppercase tracking-wider border-r-2 border-slate-900 text-right">Raw Score</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-900 uppercase tracking-wider border-r-2 border-slate-900 text-right">Percentage</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-900 uppercase tracking-wider text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y-2 divide-slate-200">
                    {schoolRoster.map((student) => (
                      <tr key={student.submissionId} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4 border-r-2 border-slate-200 text-center">
                          <span className="font-black text-xl text-slate-900">
                            #{student.rank}
                          </span>
                        </td>
                        <td className="px-6 py-4 border-r-2 border-slate-200">
                          <div className="font-bold text-slate-900 text-lg">{student.studentName || student.invitedEmail}</div>
                          {!student.studentName && <div className="text-xs font-medium text-slate-400">Name pending</div>}
                        </td>
                        <td className="px-6 py-4 border-r-2 border-slate-200 text-right">
                          <span className="font-bold text-slate-700 text-lg">{student.numericScore}</span>
                          <span className="text-sm text-slate-400 font-medium ml-1">/ {totalMarks}</span>
                        </td>
                        <td className="px-6 py-4 border-r-2 border-slate-200 text-right">
                          <span className="font-bold text-slate-900 text-lg">{student.percentage}%</span>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <Link
                            href={`/educator/results/${student.submissionId}`}
                            className="inline-block bg-white text-slate-900 font-bold border-2 border-slate-900 hover:bg-slate-900 hover:text-white px-4 py-2 text-xs uppercase tracking-wider transition-colors"
                          >
                            View Full Paper
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'global' && (
          <div className="bg-white border-2 border-slate-900 rounded-none overflow-hidden shadow-[4px_4px_0px_0px_rgba(15,23,42,1)]">
            <div className="bg-slate-900 text-white p-4 flex justify-between items-center">
              <h2 className="text-xl font-bold uppercase tracking-wider">Global Leaderboard</h2>
              <span className="text-xs font-bold bg-amber-400 text-amber-950 px-2 py-1 uppercase tracking-widest">Top 50 Only</span>
            </div>
            {globalTop50.length === 0 ? (
              <div className="p-8 text-center text-slate-500 font-medium">
                No graded submissions found globally yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-100 border-b-2 border-slate-900">
                      <th className="px-6 py-4 text-xs font-bold text-slate-900 uppercase tracking-wider border-r-2 border-slate-900 w-24 text-center">Global Rank</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-900 uppercase tracking-wider border-r-2 border-slate-900">Student Name</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-900 uppercase tracking-wider border-r-2 border-slate-900">School</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-900 uppercase tracking-wider text-right">Final Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y-2 divide-slate-200">
                    {globalTop50.map((student) => (
                      <tr key={student.submissionId} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4 border-r-2 border-slate-200 text-center">
                          <span className="font-black text-xl text-slate-900">
                            #{student.rank}
                          </span>
                        </td>
                        <td className="px-6 py-4 border-r-2 border-slate-200">
                          <div className="font-bold text-slate-900 text-lg">
                            {student.studentName ? (
                              // Optional privacy mask logic here if required by schema, but schema doesn't specify.
                              // Displaying full name for now.
                              student.studentName
                            ) : (
                              student.invitedEmail.split('@')[0] + '***'
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 border-r-2 border-slate-200">
                          <span className="font-medium text-slate-600 uppercase tracking-wide text-sm">{student.schoolName}</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="font-black text-blue-700 text-xl">{student.percentage}%</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
