import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { formatSAST } from '@/lib/sast';
import { memberships, rounds, users, submissions, results, roundQualifications } from '@/lib/db/schema';
import { getMarkingWindowStatus } from '@/domain/rounds/paper-marking';
import { getRoundTotalMarks } from '@/domain/rounds/score-percentage';
import { eq, and, inArray } from 'drizzle-orm';
import Link from 'next/link';
import OfflineMarksForm from './OfflineMarksForm';

export const dynamic = 'force-dynamic';

export default async function OfflineMarksPage(props: { params: Promise<{ roundId: string }> }) {
  const params = await props.params;
  const roundId = params.roundId;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Auth and portal check
  const educatorMemberships = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), eq(memberships.role, 'educator')));

  const cookieStore = await cookies();
  const activeSchoolId = cookieStore.get('active_school_id')?.value;
  const activeSchoolMemberships = activeSchoolId 
    ? educatorMemberships.filter((m) => m.schoolId === activeSchoolId)
    : educatorMemberships.filter(m => m.schoolId === educatorMemberships[0].schoolId);

  if (activeSchoolMemberships.length === 0 || !activeSchoolMemberships[0].schoolId) {
    redirect('/dashboard');
  }

  const schoolId = activeSchoolMemberships[0].schoolId;

  // Get the round details
  const roundRows = await db.select().from(rounds).where(eq(rounds.id, roundId));
  if (roundRows.length === 0) {
    redirect('/educator/rounds');
  }
  const round = roundRows[0];

  // Only educators of this olympiad, for paper/hybrid rounds
  if (
    round.deliveryMethod === 'online' ||
    !activeSchoolMemberships.some((m) => m.portalId === round.portalId)
  ) {
    redirect('/educator/rounds?tab=offline');
  }

  const now = new Date();
  const markingWindow = getMarkingWindowStatus(round, now);
  if (markingWindow.status !== 'open') {
    return (
      <div className="min-h-screen bg-white font-sans w-full px-4 md:px-8 pt-10 pb-20">
        <div className="max-w-4xl mx-auto">
          <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6">
            <p className="text-red-700 font-medium">{markingWindow.reason}</p>
          </div>
          <Link href="/educator/rounds?tab=offline" className="text-blue-900 font-bold hover:underline">
            ← Back to Assessments
          </Link>
        </div>
      </div>
    );
  }

  // Marks obtainable: the question bank, or the organiser's paper total
  const maxMarks = (await getRoundTotalMarks([roundId])).get(roundId) ?? 0;

  // 1. Fetch all student memberships for this school
  const studentMemberships = await db
    .select({
      id: memberships.id,
      userId: memberships.userId,
      invitedEmail: memberships.invitedEmail,
    })
    .from(memberships)
    .where(
      and(
        eq(memberships.schoolId, schoolId),
        eq(memberships.role, 'student'),
        eq(memberships.portalId, round.portalId)
      )
    );
  
  if (studentMemberships.length === 0) {
    return (
      <div className="min-h-screen bg-white font-sans w-full px-4 md:px-8 pt-10 pb-20">
        <div className="max-w-4xl mx-auto">
           <h1 className="font-serif text-3xl font-bold text-slate-900 mb-8">No students found</h1>
        </div>
      </div>
    );
  }

  const membershipIds = studentMemberships.map(m => m.id);

  // If this is not orderIndex 1, we might need to check roundQualifications.
  let qualifiedMembershipIds = membershipIds;
  if (round.orderIndex > 1) {
    const qualifications = await db
      .select()
      .from(roundQualifications)
      .where(
        and(
          eq(roundQualifications.roundId, roundId),
          inArray(roundQualifications.studentMembershipId, membershipIds)
        )
      );
    qualifiedMembershipIds = qualifications.map(q => q.studentMembershipId);
  }

  // Filter students who are qualified
  const qualifiedStudents = studentMemberships.filter(m => qualifiedMembershipIds.includes(m.id));

  // Fetch actual user data for names
  const userIds = qualifiedStudents.map(m => m.userId).filter(Boolean) as string[];
  const userRows = userIds.length > 0 ? await db.select().from(users).where(inArray(users.id, userIds)) : [];
  
  // 2. Fetch submissions for this round from these students
  const roundSubmissions = qualifiedMembershipIds.length > 0 
    ? await db
        .select()
        .from(submissions)
        .where(
          and(
            eq(submissions.roundId, roundId),
            inArray(submissions.studentMembershipId, qualifiedMembershipIds)
          )
        )
    : [];

  const submissionIds = roundSubmissions.map(s => s.id);
  const roundResults = submissionIds.length > 0 
    ? await db.select().from(results).where(inArray(results.submissionId, submissionIds))
    : [];

  // 3. Filter out those who have an 'online' submission
  const onlineSubmissionMembershipIds = roundSubmissions
    .filter(s => s.submissionType === 'online')
    .map(s => s.studentMembershipId);

  const eligibleStudents = qualifiedStudents.filter(m => !onlineSubmissionMembershipIds.includes(m.id));

  // Format data for the form
  const formattedStudents = eligibleStudents.map(m => {
    const user = userRows.find(u => u.id === m.userId);
    const submission = roundSubmissions.find(s => s.studentMembershipId === m.id && s.submissionType === 'offline');
    let existingScore: number | null = null;
    
    if (submission) {
      const result = roundResults.find(r => r.submissionId === submission.id);
      if (result && result.score) {
        existingScore = parseFloat(result.score);
      }
    }

    return {
      membershipId: m.id,
      name: user ? user.name : m.invitedEmail,
      email: user ? user.email : m.invitedEmail,
      existingScore
    };
  });

  return (
    <div className="min-h-screen bg-white font-sans w-full px-4 md:px-8 pt-10 pb-20">
      <div className="max-w-4xl mx-auto">
        <Link href="/educator/rounds?tab=offline" className="inline-flex items-center text-slate-500 hover:text-blue-900 font-bold uppercase tracking-wider text-xs mb-6 transition-colors">
          <span className="mr-2">←</span> Back to Assessments
        </Link>
        
        <h1 className="font-serif text-3xl font-bold text-slate-900 mb-2">
          Offline Marks Entry
        </h1>
        <p className="text-slate-600 mb-4">
          {round.name} • {formattedStudents.length} eligible students
        </p>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-amber-50 border border-amber-200 p-4 mb-8">
          <p className="text-amber-900 text-sm font-medium m-0">
            Marking deadline: <strong>{formatSAST(markingWindow.deadline)}</strong>. Marks
            can be changed until then; after results are published, changes go
            through a remark.
          </p>
          <div className="flex gap-3 shrink-0">
            <a href={`/api/rounds/${roundId}/paper?kind=paper`} className="text-sm font-bold text-blue-900 hover:underline">
              Question paper
            </a>
            {now >= round.closesAt && (
              <a href={`/api/rounds/${roundId}/paper?kind=memo`} className="text-sm font-bold text-blue-900 hover:underline">
                Memo
              </a>
            )}
          </div>
        </div>
        {maxMarks === 0 && (
          <p className="text-sm text-slate-500 mb-6">
            The organiser hasn&apos;t set a total for this paper, so marks can&apos;t be
            checked against a maximum or shown as percentages.
          </p>
        )}

        <OfflineMarksForm 
          roundId={roundId} 
          students={formattedStudents} 
          maxMarks={maxMarks}
        />
      </div>
    </div>
  );
}
