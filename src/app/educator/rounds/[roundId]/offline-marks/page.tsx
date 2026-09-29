import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { memberships, rounds, users, submissions, results, questions, roundQualifications } from '@/lib/db/schema';
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

  // Verify the 24 hour window
  const now = new Date();
  const offlineGradingClosesAt = new Date(round.closesAt.getTime() + 24 * 60 * 60 * 1000);
  
  // Enforce the 24 hour window
  if (now > offlineGradingClosesAt) {
    return (
      <div className="min-h-screen bg-white font-sans w-full px-4 md:px-8 pt-10 pb-20">
        <div className="max-w-4xl mx-auto">
          <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6">
            <p className="text-red-700 font-medium">The 24-hour grading window for this round has closed.</p>
          </div>
          <Link href="/educator/rounds?tab=offline" className="text-blue-900 font-bold hover:underline">
            ← Back to Assessments
          </Link>
        </div>
      </div>
    );
  }

  // Fetch maximum marks for the round
  const roundQuestions = await db.select().from(questions).where(eq(questions.roundId, roundId));
  const maxMarks = roundQuestions.reduce((sum, q) => sum + q.marks, 0);

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
        <p className="text-slate-600 mb-8">
          {round.name} • {formattedStudents.length} eligible students
        </p>

        <OfflineMarksForm 
          roundId={roundId} 
          students={formattedStudents} 
          maxMarks={maxMarks}
        />
      </div>
    </div>
  );
}
