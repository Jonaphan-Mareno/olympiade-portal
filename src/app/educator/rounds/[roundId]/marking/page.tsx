import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { submissions, results, memberships, users, rounds, questions, questionPapers, examSittings, studentAnswers } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import EducatorGradingForm from './EducatorGradingForm';
import Link from 'next/link';
import { deriveRoundState } from '@/domain/rounds/round-state-machine';

export const dynamic = 'force-dynamic';

export default async function EducatorMarkingPage({
  params,
  searchParams,
}: {
  params: Promise<{ roundId: string }>;
  searchParams: Promise<{ submissionId?: string }>;
}) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const roundId = resolvedParams.roundId;
  const submissionId = resolvedSearchParams.submissionId;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Fetch the round
  const [round] = await db
    .select()
    .from(rounds)
    .where(eq(rounds.id, roundId));

  if (!round) {
    return <div>Round not found.</div>;
  }

  // Strict Access Control: only closed or released rounds
  const now = new Date();
  const state = deriveRoundState(round, now);
  if (state === 'scheduled' || state === 'open') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border-2 border-red-200 p-8 rounded-lg max-w-md text-center shadow-sm">
          <h2 className="text-xl font-bold text-red-700 mb-4">Access Denied</h2>
          <p className="text-slate-700 mb-6">
            This round is currently active. The official marking memo and grading interface are locked to prevent cheating until the round officially closes.
          </p>
          <Link href={`/educator`} className="text-blue-600 hover:underline font-medium">
            ← Return to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  // Verify educator access and get schoolId
  const [educatorMembership] = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, user.id),
        eq(memberships.portalId, round.portalId),
        eq(memberships.role, 'educator'),
        eq(memberships.status, 'accepted')
      )
    );

  if (!educatorMembership || !educatorMembership.schoolId) {
    redirect('/dashboard');
  }

  const schoolId = educatorMembership.schoolId;

  // Fetch all questions for this round
  const roundQuestions = await db
    .select()
    .from(questions)
    .where(eq(questions.roundId, roundId));

  // Try to find memo from questionPapers
  const [paper] = await db
    .select()
    .from(questionPapers)
    .where(eq(questionPapers.roundId, roundId));

  let memoText = '';
  let memoUrl = '';
  if (paper && paper.answerKeyJson) {
    if (typeof paper.answerKeyJson === 'object') {
      const parsedJson = paper.answerKeyJson as any;
      if (parsedJson.memo) memoText = parsedJson.memo;
      if (parsedJson.memoUrl) memoUrl = parsedJson.memoUrl;
      // If neither is present but it's an object, dump JSON just in case
      if (!memoText && !memoUrl) {
        memoText = JSON.stringify(paper.answerKeyJson, null, 2);
      }
    } else {
      memoText = JSON.stringify(paper.answerKeyJson, null, 2);
    }
  }

  // Fetch all submissions for this round for this school
  const allSubmissions = await db
    .select({
      id: submissions.id,
      submissionType: submissions.submissionType,
      fileUrl: submissions.fileUrl,
      answersJson: submissions.answersJson,
      status: submissions.status,
      studentMembershipId: submissions.studentMembershipId,
      studentName: users.name,
      schoolId: memberships.schoolId,
      invitedEmail: memberships.invitedEmail,
      resultId: results.id,
      resultStatus: results.status,
    })
    .from(submissions)
    .innerJoin(memberships, eq(submissions.studentMembershipId, memberships.id))
    .leftJoin(users, eq(memberships.userId, users.id))
    .leftJoin(results, eq(submissions.id, results.submissionId))
    .where(
      and(
        eq(submissions.roundId, roundId),
        eq(submissions.status, 'submitted'),
        eq(memberships.schoolId, schoolId)
      )
    );

  // Filter to show pending or queued_for_marker submissions
  const markableSubmissions = allSubmissions.filter(
    (s) => !s.resultId || s.resultStatus === 'queued_for_marker'
  );

  let selectedSubmission = null;
  let initialGrades = undefined;

  if (submissionId) {
    selectedSubmission = markableSubmissions.find((s) => s.id === submissionId);
    
    if (selectedSubmission && selectedSubmission.studentMembershipId && paper) {
      // Find the sitting to load initial grades
      const sitting = await db.query.examSittings.findFirst({
        where: and(
          eq(examSittings.studentMembershipId, selectedSubmission.studentMembershipId),
          eq(examSittings.questionPaperId, paper.id)
        )
      });

      if (sitting) {
        const answers = await db.select().from(studentAnswers).where(eq(studentAnswers.sittingId, sitting.id));
        if (answers.length > 0) {
          initialGrades = answers.flatMap((a) =>
            a.questionId === null
              ? []
              : [
                  {
                    questionId: a.questionId,
                    score: parseFloat(a.manualScore as string) || 0,
                    feedback: a.educatorFeedback || '',
                  },
                ]
          );
        }
      }
    }
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="bg-blue-900 border-b border-blue-800 p-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-serif font-bold text-white mb-1">
            Manual Marking
          </h1>
          <p className="text-blue-200 text-sm m-0">
            {round.name} • Educator View
          </p>
        </div>
        <Link
          href={`/educator/rounds/${roundId}`}
          className="text-white hover:text-blue-200 transition-colors text-sm font-medium border border-blue-700 hover:border-blue-500 rounded px-4 py-2"
        >
          ← Back to Round
        </Link>
      </div>

      <div className="max-w-[1400px] mx-auto p-6 flex flex-col lg:flex-row gap-6">
        
        {/* Left column: Submissions List */}
        <div className="w-full lg:w-1/4 flex-shrink-0">
          <div className="bg-white border border-slate-200 rounded-md overflow-hidden flex flex-col max-h-[calc(100vh-12rem)]">
            <div className="p-4 bg-slate-50 border-b border-slate-200 shrink-0">
              <h3 className="font-semibold text-slate-900 m-0">Pending Marking</h3>
            </div>
            <ul className="divide-y divide-slate-100 overflow-y-auto flex-1">
              {markableSubmissions.length === 0 ? (
                <li className="p-4 text-sm text-slate-500 italic text-center">
                  All submissions are fully marked or moderated.
                </li>
              ) : (
                markableSubmissions.map((sub) => {
                  const isSelected = sub.id === submissionId;
                  const isDraft = sub.resultStatus === 'queued_for_marker';
                  return (
                    <li key={sub.id}>
                      <a
                        href={`?submissionId=${sub.id}`}
                        className={`block p-4 transition-colors ${
                          isSelected
                            ? 'bg-blue-50 border-l-4 border-blue-600'
                            : 'hover:bg-slate-50 border-l-4 border-transparent'
                        }`}
                      >
                        <div className="font-medium text-slate-900 truncate">
                          {sub.studentName || sub.invitedEmail}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-slate-500 uppercase">
                            {sub.submissionType}
                          </span>
                          {isDraft ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                              Draft Saved
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                              Needs Marking
                            </span>
                          )}
                        </div>
                      </a>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </div>

        {/* Right column: Grading Interface */}
        <div className="w-full lg:w-3/4">
          {selectedSubmission ? (
            <EducatorGradingForm 
              roundId={roundId}
              submission={selectedSubmission}
              questions={roundQuestions}
              initialGrades={initialGrades}
              memoText={memoText}
              memoUrl={memoUrl}
            />
          ) : (
            <div className="h-[calc(100vh-12rem)] min-h-[400px] flex items-center justify-center border border-dashed border-slate-300 rounded-md bg-slate-50">
              <p className="text-slate-500 italic">
                Select a submission from your school to begin marking.
              </p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
