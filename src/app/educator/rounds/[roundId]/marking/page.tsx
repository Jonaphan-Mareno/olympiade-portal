import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { submissions, results, memberships, users, rounds, questions, questionPapers, examSittings, studentAnswers } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import EducatorGradingForm from './EducatorGradingForm';
import Link from 'next/link';
import { deriveRoundState } from '@/domain/rounds/round-state-machine';
import { publishRoundResults } from './actions';

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
  if ((state === 'scheduled' || state === 'open') && round.deliveryMethod !== 'online') {
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
      score: results.score,
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

  // Filter to show pending or queued_for_marker submissions, 
  // or auto_marked online submissions if there are manual questions
  const hasManualQuestions = roundQuestions.some(q => q.questionType === 'free_text');
  
  const isSubmissionPending = (s: any) => !s.resultId || s.resultStatus === 'queued_for_marker' || (hasManualQuestions && s.resultStatus === 'auto_marked');
  const pendingSubmissionsCount = allSubmissions.filter(isSubmissionPending).length;

  const submissionsWithScores = allSubmissions
    .filter(s => !isSubmissionPending(s))
    .map(s => ({ ...s, parsedScore: parseFloat(s.score as string) || 0 }))
    .sort((a, b) => b.parsedScore - a.parsedScore);

  const allScores = submissionsWithScores.map(s => s.parsedScore);
  const rankedSubmissions = new Map<string, number>();
  submissionsWithScores.forEach(s => {
    rankedSubmissions.set(s.id, allScores.indexOf(s.parsedScore) + 1);
  });

  let selectedSubmission = null;
  let initialGrades = undefined;

  if (submissionId) {
    selectedSubmission = allSubmissions.find((s) => s.id === submissionId);
    
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
            {round.name}
          </p>
        </div>
        <div className="flex items-center gap-4">
          {pendingSubmissionsCount === 0 && allSubmissions.length > 0 && (
            round.resultsPublishedAt && new Date(round.resultsPublishedAt) <= now ? (
              <button
                disabled
                className="bg-slate-300 text-slate-500 cursor-not-allowed px-4 py-2 text-sm font-bold uppercase tracking-wider rounded-none border-2 border-slate-400"
              >
                Results Published
              </button>
            ) : (
              <form action={publishRoundResults.bind(null, roundId)}>
                <button
                  type="submit"
                  className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 text-sm font-bold uppercase tracking-wider transition-colors border-2 border-green-700 rounded-none inline-block shadow-sm"
                >
                  Publish Results
                </button>
              </form>
            )
          )}
          {round.deliveryMethod === 'online' ? null : now < round.closesAt ? (
            <button
              disabled
              title="Memo is locked until the round closes"
              className="bg-slate-300 text-slate-500 cursor-not-allowed px-4 py-2 text-sm font-bold uppercase tracking-wider rounded-none border-2 border-slate-400"
            >
              Memo Locked
            </button>
          ) : memoUrl ? (
            <a
              href={memoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-amber-400 hover:bg-amber-500 text-amber-950 px-4 py-2 text-sm font-bold uppercase tracking-wider transition-colors border-2 border-amber-500 rounded-none inline-block"
            >
              Download Official Memo
            </a>
          ) : (
             <button
              disabled
              title="No memo uploaded"
              className="bg-slate-300 text-slate-500 cursor-not-allowed px-4 py-2 text-sm font-bold uppercase tracking-wider rounded-none border-2 border-slate-400"
            >
              No Memo Available
            </button>
          )}
          <Link
            href={`/educator/rounds`}
            prefetch={true}
            className="text-white hover:text-blue-200 transition-colors text-sm font-medium border border-blue-700 hover:border-blue-500 rounded px-4 py-2"
          >
            ← Back to Rounds
          </Link>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto p-6 flex flex-col lg:flex-row gap-6">
        
        {/* Left column: Submissions List */}
        <div className="w-full lg:w-1/4 flex-shrink-0">
          <div className="bg-white border border-slate-200 rounded-md overflow-hidden flex flex-col max-h-[calc(100vh-12rem)]">
            <div className="p-4 bg-slate-50 border-b border-slate-200 shrink-0 flex items-center justify-between">
              <h3 className="font-semibold text-slate-900 m-0">Pending Marking</h3>
              <span className="text-slate-500 text-sm font-medium">
                {pendingSubmissionsCount} left
              </span>
            </div>
            <ul className="divide-y divide-slate-100 overflow-y-auto flex-1">
              {allSubmissions.length === 0 ? (
                <li className="p-4 text-sm text-slate-500 italic text-center">
                  No submissions have been received yet.
                </li>
              ) : (
                allSubmissions.map((sub) => {
                  const isSelected = sub.id === submissionId;
                  const isPending = isSubmissionPending(sub);
                  const rank = rankedSubmissions.get(sub.id);
                  return (
                    <li key={sub.id}>
                      <a
                        href={`?submissionId=${sub.id}`}
                        className={`block p-4 transition-colors ${
                          !isPending
                            ? 'bg-green-50 hover:bg-green-100'
                            : isSelected
                            ? 'bg-blue-50'
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="font-medium truncate text-slate-900 flex justify-between items-center">
                          <span>{sub.studentName || sub.invitedEmail}</span>
                          {!isPending && rank && (
                            <span className="text-xs font-bold text-green-700 bg-green-200 px-2 py-0.5 rounded-full whitespace-nowrap ml-2">
                              Rank #{rank}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs uppercase text-slate-500">
                            {sub.submissionType}
                          </span>
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
              questions={roundQuestions.map((q, i) => ({ ...q, originalIndex: i + 1 })).filter((q) => q.questionType === 'free_text')}
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
