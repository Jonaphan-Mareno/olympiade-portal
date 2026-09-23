import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { submissions, results, questions, memberships, rounds } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { deriveRoundState } from '@/domain/rounds/round-state-machine';
import { notFound } from 'next/navigation';
import Link from 'next/link';

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ portalId: string; roundId: string }>;
}) {
  // 1. Resolve params using the exact folder names
  const resolvedParams = await params;
  const { portalId, roundId } = resolvedParams;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return <div>Please log in to view your results.</div>;
  }

  // 2. Fetch the student's membership for this portal
  const [membership] = await db
    .select()
    .from(memberships)
    .where(and(
      eq(memberships.userId, user.id),
      eq(memberships.portalId, portalId)
    ))
    .limit(1);

  if (!membership) return notFound();

  // 2.5. Fetch Round and check embargo state
  const [round] = await db.select().from(rounds).where(eq(rounds.id, roundId));
  if (!round) return notFound();

  const roundState = deriveRoundState(round);
  if (roundState !== 'released') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-lg shadow-sm border border-slate-200 text-center max-w-lg w-full">
          <h2 className="text-2xl font-serif font-bold text-slate-900 mb-2">Results Embargoed</h2>
          <p className="text-slate-600 mb-6">
            Results are under review. Check back when the round is officially released.
          </p>
          <Link href={`/results/${portalId}`} className="text-blue-600 font-medium hover:underline">
            &larr; Back to Results
          </Link>
        </div>
      </div>
    );
  }

  // 3. Fetch the submission and the result
  const [submissionData] = await db
    .select({
      submission: submissions,
      result: results,
    })
    .from(submissions)
    .leftJoin(results, eq(results.submissionId, submissions.id))
    .where(and(
      eq(submissions.studentMembershipId, membership.id),
      eq(submissions.roundId, roundId)
    ))
    .limit(1);

  if (!submissionData) return notFound();

  // 4. Fetch the questions to display the test
  const roundQuestions = await db
    .select()
    .from(questions)
    .where(eq(questions.roundId, roundId));

  const { submission, result } = submissionData;
  const studentAnswers = (submission.answersJson as Record<string, string>) || {};

  // Raw mark out of the round's total, plus the percentage. The total is the
  // sum of the round's question marks — the same basis the auto-marker uses
  // when it scores the submission on submit. Rounds without questions in the
  // bank (e.g. manually graded paper rounds) have no computable total, so
  // they fall back to the raw mark alone.
  const totalMarks = roundQuestions.reduce(
    (total, q) => total + (q.marks ?? 1),
    0
  );
  const score = result?.score != null ? Number(result.score) : 0;
  const percentage =
    totalMarks > 0 ? Math.round((score / totalMarks) * 100) : null;

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 md:px-8">
      <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-sm border border-slate-200 p-8">
        
        {/* Header */}
        <div className="flex justify-between items-start border-b border-slate-200 pb-6 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Detailed Review</h1>
            <p className="text-slate-600">Review your answers and see where you can improve.</p>
          </div>
          <div className="text-right bg-blue-50 text-blue-900 px-6 py-4 rounded-lg border border-blue-100">
            <div className="text-sm font-semibold uppercase tracking-wider mb-1">Final Score</div>
            <div className="text-3xl font-bold">
              {totalMarks > 0 ? `${score} / ${totalMarks}` : score}
            </div>
            {percentage !== null && (
              <div className="text-sm font-semibold text-blue-700 mt-1">
                {percentage}%
              </div>
            )}
          </div>
        </div>

        {/* Questions & Answers List */}
        <div className="space-y-8">
          {roundQuestions.map((q, index) => {
            const studentAns = studentAnswers[q.id] || 'No answer provided';
            // Basic string comparison for the UI
            const isCorrect = String(q.correctAnswer).toLowerCase().trim() === String(studentAns).toLowerCase().trim();

            return (
              <div key={q.id} className="border border-slate-200 rounded-lg p-6">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="font-semibold text-lg text-slate-900">
                    Question {index + 1} <span className="text-sm font-normal text-slate-500 ml-2">({q.marks} marks)</span>
                  </h3>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${isCorrect ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                    {isCorrect ? 'Correct' : 'Incorrect'}
                  </span>
                </div>
                
                <p className="text-slate-800 mb-6">{q.prompt}</p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-slate-50 p-4 rounded-md border border-slate-100">
                    <div className="text-xs font-semibold text-slate-500 uppercase mb-1">Your Answer</div>
                    <div className="text-slate-900">{studentAns}</div>
                  </div>
                  <div className="bg-blue-50 p-4 rounded-md border border-blue-100">
                    <div className="text-xs font-semibold text-blue-700 uppercase mb-1">Correct Answer</div>
                    <div className="text-blue-900">{String(q.correctAnswer)}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer Navigation */}
        <div className="mt-10 pt-6 border-t border-slate-200">
          <Link 
            href={`/results/${portalId}`}
            className="text-blue-600 hover:text-blue-800 font-medium transition-colors"
          >
            &larr; Back to Dashboard
          </Link>
        </div>

      </div>
    </div>
  );
}