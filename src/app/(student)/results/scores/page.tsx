import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import {
  memberships,
  portals,
  rounds,
  submissions,
  results as resultsTable
} from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import Link from 'next/link';
import HeroBanner from '@/components/ui/HeroBanner';

export const dynamic = 'force-dynamic';

export default async function StudentScoresPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

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

  if (portalIds.length === 0) {
    return (
      <div className="min-h-screen bg-[#F8FAFC]">
        <div className="max-w-6xl mx-auto p-8">No records found.</div>
      </div>
    );
  }

  const [portalRows, allRounds, studentSubmissions] = await Promise.all([
    db.select().from(portals).where(inArray(portals.id, portalIds)),
    db.select().from(rounds).where(inArray(rounds.portalId, portalIds)),
    db.select({
        submissionId: submissions.id,
        roundId: submissions.roundId,
        score: resultsTable.score,
        status: submissions.status,
      })
      .from(submissions)
      .leftJoin(resultsTable, eq(resultsTable.submissionId, submissions.id))
      .where(inArray(submissions.studentMembershipId, membershipIds))
  ]);

  const portalMap = new Map(portalRows.map(p => [p.id, p]));
  const roundMap = new Map(allRounds.map(r => [r.id, r]));

  const now = new Date();

  // We want to show ALL submitted rounds.
  const submittedRecords = studentSubmissions
    .filter(s => s.status === 'submitted')
    .map(s => {
       const r = roundMap.get(s.roundId);
       const p = portalMap.get(r?.portalId || '');
       return { 
         ...s, 
         round: r, 
         portal: p,
         publishedAt: r?.resultsPublishedAt 
       };
    });

  // Calculate ranks for those that are published
  const recordsWithRanks = [];
  for (const s of submittedRecords) {
    const isPublished = s.publishedAt && s.publishedAt <= now && s.score !== null;
    let rank = null;
    let totalStudents = null;

    if (isPublished) {
      const allRoundResults = await db.select({
        score: resultsTable.score
      }).from(resultsTable)
        .innerJoin(submissions, eq(resultsTable.submissionId, submissions.id))
        .where(eq(submissions.roundId, s.roundId));

      const scores = allRoundResults
        .map(r => parseFloat(r.score as string) || 0)
        .sort((a, b) => b - a);

      const studentScore = parseFloat(s.score as string) || 0;
      rank = scores.indexOf(studentScore) + 1;
      totalStudents = scores.length;
    }

    recordsWithRanks.push({
      ...s,
      isPublished,
      rank,
      totalStudents
    });
  }

  // Sort by most recently published/submitted
  recordsWithRanks.sort((a, b) => {
    return (b.publishedAt?.getTime() || 0) - (a.publishedAt?.getTime() || 0);
  });

  const displayName = user.user_metadata?.full_name || user.email;
  const firstName = displayName?.split(' ')[0] || 'Student';
  const initial = (user.user_metadata?.full_name?.charAt(0) || user.email?.charAt(0) || '?').toUpperCase();

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-8">
        
        <div className="mb-4">
          <h2 className="font-serif text-3xl text-blue-950 font-bold">
            All Test Results
          </h2>
        </div>

        {recordsWithRanks.length === 0 ? (
          <div className="bg-white border-2 border-slate-200 p-12 text-center flex flex-col items-center">
            <span className="text-4xl mb-4">📝</span>
            <p className="text-slate-500 font-medium">You haven't completed any Olympiads yet.</p>
          </div>
        ) : (
          <div className="bg-white border-2 border-slate-200 shadow-sm rounded-none overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b-2 border-slate-200">
                    <th className="px-6 py-4 text-xs font-bold text-blue-950 uppercase tracking-wider">Olympiad</th>
                    <th className="px-6 py-4 text-xs font-bold text-blue-950 uppercase tracking-wider">Round</th>
                    <th className="px-6 py-4 text-xs font-bold text-blue-950 uppercase tracking-wider text-center">Score</th>
                    <th className="px-6 py-4 text-xs font-bold text-blue-950 uppercase tracking-wider text-center">Ranking</th>
                    <th className="px-6 py-4 text-xs font-bold text-blue-950 uppercase tracking-wider text-right">Certificate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recordsWithRanks.map((record) => (
                    <tr key={record.submissionId} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-5">
                        <div className="font-bold text-slate-900">{record.portal?.name || 'Unknown Olympiad'}</div>
                      </td>
                      <td className="px-6 py-5">
                        <span className="font-medium text-slate-600 uppercase tracking-wide text-xs">
                          {record.round?.name || 'Unknown Round'}
                        </span>
                      </td>
                      
                      {record.isPublished ? (
                        <>
                          <td className="px-6 py-5 text-center">
                            <span className="font-bold text-slate-900 text-lg">{record.score}%</span>
                          </td>
                          <td className="px-6 py-5 text-center">
                            <span className="font-bold text-blue-950 text-lg">
                              #{record.rank}
                            </span>
                            <span className="text-xs text-slate-500 font-medium ml-1">
                              / {record.totalStudents}
                            </span>
                          </td>
                          <td className="px-6 py-5 text-right">
                            <a 
                              href={`/api/certificates/${record.submissionId}`}
                              className="inline-flex items-center gap-2 bg-blue-950 text-white font-bold text-xs uppercase tracking-wider py-2 px-4 hover:bg-blue-800 transition-colors"
                              download
                            >
                              Download
                            </a>
                          </td>
                        </>
                      ) : (
                        <td colSpan={3} className="px-6 py-5 text-center">
                          <span className="inline-flex items-center gap-2 px-3 py-1 bg-amber-50 text-amber-700 border border-amber-200 font-bold text-xs uppercase tracking-wider">
                            <svg className="w-4 h-4 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Awaiting Results From Marker
                          </span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
