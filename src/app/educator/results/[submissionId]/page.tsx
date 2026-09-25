import { createClient } from '@/lib/supabase/server';
import { redirect, notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import {
  memberships,
  submissions,
  results,
  users,
  questions,
  examSittings,
  studentAnswers,
  rounds,
} from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import Link from 'next/link';
import RequestRemarkButton from './RequestRemarkButton';

export const dynamic = 'force-dynamic';

export default async function ViewFullPaperPage({
  params,
}: {
  params: Promise<{ submissionId: string }>;
}) {
  const resolvedParams = await params;
  const { submissionId } = resolvedParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const cookieStore = await cookies();
  const activeSchoolId = cookieStore.get('active_school_id')?.value;
  if (!activeSchoolId) {
    return <div>No school assigned.</div>;
  }

  // Fetch submission and related data
  const [subData] = await db
    .select({
      submission: submissions,
      result: results,
      studentName: users.name,
      invitedEmail: memberships.invitedEmail,
      schoolId: memberships.schoolId,
      roundName: rounds.name,
      roundId: rounds.id,
    })
    .from(submissions)
    .innerJoin(memberships, eq(submissions.studentMembershipId, memberships.id))
    .leftJoin(users, eq(memberships.userId, users.id))
    .leftJoin(results, eq(submissions.id, results.submissionId))
    .innerJoin(rounds, eq(submissions.roundId, rounds.id))
    .where(eq(submissions.id, submissionId))
    .limit(1);

  if (!subData) {
    return notFound();
  }

  // Enforce school scoping
  if (subData.schoolId !== activeSchoolId) {
    return (
      <div className="p-8 text-center text-slate-500">
        You do not have permission to view this submission.
      </div>
    );
  }

  // Fetch all questions for this round
  const roundQuestions = await db
    .select()
    .from(questions)
    .where(eq(questions.roundId, subData.roundId));

  // Fetch student answers if there's a sitting
  let savedAnswers: Record<string, any> = {};
  if (subData.submission.submissionType === 'online') {
    const sitting = await db.query.examSittings.findFirst({
      where: and(
        eq(examSittings.studentMembershipId, subData.submission.studentMembershipId!)
      ),
    });

    if (sitting) {
      const answersList = await db
        .select()
        .from(studentAnswers)
        .where(eq(studentAnswers.sittingId, sitting.id));

      answersList.forEach((a) => {
        savedAnswers[a.questionId!] = a;
      });
    }
  }

  const getStudentAnswer = (questionId: string) => {
    if (subData.submission.submissionType === 'online') {
      const jsonAnswers = subData.submission.answersJson as Record<string, string>;
      return jsonAnswers?.[questionId] || 'No answer provided.';
    }
    return 'Offline submission (see uploaded paper).';
  };

  const formatAnswerKey = (correctAnswer: any) => {
    if (!correctAnswer) return 'No specific key provided.';
    if (typeof correctAnswer === 'string') return correctAnswer;
    if (typeof correctAnswer === 'object') {
      if (correctAnswer.memo) return correctAnswer.memo;
      if (correctAnswer.text) return correctAnswer.text;
      return JSON.stringify(correctAnswer, null, 2);
    }
    return String(correctAnswer);
  };

  const studentIdentifier = subData.studentName || subData.invitedEmail;

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <div className="bg-blue-900 border-b border-blue-800 p-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-serif font-bold text-white mb-1">
            Full Paper Review
          </h1>
          <p className="text-blue-200 text-sm m-0">
            {subData.roundName} • {studentIdentifier}
          </p>
        </div>
        <div className="flex items-center gap-4">
          {subData.result?.status !== 'remark_requested' && subData.result?.status !== 'remark_resolved' && (
            <RequestRemarkButton submissionId={submissionId} />
          )}
          <Link
            href="/educator/results"
            className="text-white hover:text-blue-200 transition-colors text-sm font-medium border border-blue-700 hover:border-blue-500 rounded-none px-4 py-2 inline-block"
          >
            ← Back to Results
          </Link>
        </div>
      </div>

      <div className="max-w-4xl mx-auto mt-8 px-4 md:px-0 space-y-8">
        {(subData.result?.status === 'remark_requested' || subData.result?.status === 'remark_resolved') && (
          <div className={`p-4 rounded-md border ${subData.result.status === 'remark_resolved' ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
            <h3 className={`font-bold ${subData.result.status === 'remark_resolved' ? 'text-green-800' : 'text-amber-800'}`}>
              {subData.result.status === 'remark_resolved' ? 'Remark Resolved' : 'Remark Requested'}
            </h3>
            <p className="text-sm mt-1 mb-2 text-slate-700">
              <span className="font-semibold">Reason:</span> {subData.result.remarkReason}
            </p>
            {subData.result.status === 'remark_resolved' && subData.result.remarkOutcome && (
              <p className="text-sm text-slate-700">
                <span className="font-semibold text-green-900">Outcome:</span> {subData.result.remarkOutcome}
              </p>
            )}
          </div>
        )}

        <div className="bg-white border border-slate-200 p-6 flex justify-between items-center shadow-sm">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{studentIdentifier}</h2>
            <p className="text-slate-500 text-sm mt-1">Final Score: {subData.result?.score ?? 'N/A'}</p>
          </div>
          <div>
            <span className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider ${subData.submission.submissionType === 'online' ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'}`}>
              {subData.submission.submissionType} Submission
            </span>
          </div>
        </div>

        {roundQuestions.length === 0 ? (
          <div className="bg-white p-8 text-center border border-slate-200 shadow-sm text-slate-500 italic">
            This round has no questions configured.
          </div>
        ) : (
          roundQuestions.map((q, idx) => {
            const isManual = q.questionType === 'free_text';
            const studentAns = getStudentAnswer(q.id);
            const savedAns = savedAnswers[q.id];
            
            return (
              <div key={q.id} className="bg-white border-2 border-slate-200 rounded-none shadow-sm flex flex-col">
                <div className="bg-blue-950 p-4 flex justify-between items-center">
                  <h3 className="text-white font-bold uppercase tracking-wider text-sm">
                    Question {idx + 1}
                  </h3>
                  <div className="flex items-center gap-4">
                    {isManual && (
                      <span className="text-blue-200 text-xs font-bold uppercase tracking-wider">Manual Grading</span>
                    )}
                    <span className="text-amber-400 font-bold uppercase tracking-wider text-sm">
                      {q.marks} Marks
                    </span>
                  </div>
                </div>

                <div className="p-6 flex flex-col gap-6">
                  <div>
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                      Question Prompt
                    </h4>
                    <p className="text-slate-900 text-lg font-medium whitespace-pre-wrap">{q.prompt}</p>
                  </div>

                  <div className="flex flex-col md:flex-row gap-6">
                    <div className="flex-1 bg-slate-50 border-2 border-slate-200 p-5 rounded-none">
                      <h4 className="text-xs font-bold text-blue-950 uppercase tracking-wider mb-3">
                        Student's Answer
                      </h4>
                      <p className="text-slate-800 whitespace-pre-wrap font-medium">
                        {studentAns}
                      </p>
                    </div>

                    <div className="flex-1 bg-green-50 border-2 border-green-200 p-5 rounded-none">
                      <h4 className="text-xs font-bold text-green-900 uppercase tracking-wider mb-3">
                        Official Answer Key
                      </h4>
                      <p className="text-green-900 whitespace-pre-wrap">
                        {formatAnswerKey(q.correctAnswer)}
                      </p>
                    </div>
                  </div>

                  {isManual && savedAns && (
                    <div className="border-t-2 border-slate-100 pt-6 mt-2 flex flex-col md:flex-row gap-6 items-start bg-slate-50 p-4">
                      <div className="flex-1 w-full">
                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">
                          Educator Feedback
                        </h4>
                        <p className="text-slate-700 italic">
                          {savedAns.educatorFeedback || 'No feedback provided.'}
                        </p>
                      </div>
                      <div className="w-full md:w-48 flex-shrink-0">
                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">
                          Awarded Score
                        </h4>
                        <p className="text-2xl font-bold text-slate-900">
                          {savedAns.manualScore !== null ? savedAns.manualScore : '-'} <span className="text-base text-slate-500 font-normal">/ {q.marks}</span>
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
