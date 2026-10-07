import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { submissions, results, memberships, rounds } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { deriveRoundState } from '@/domain/rounds/round-state-machine';
import { getRoundTotalMarks } from '@/domain/rounds/score-percentage';
import { loadSittingQuestions } from '@/domain/question-bank/load-variant';
import {
  getMatchingSelections,
  matchingPairsOf,
  reassembleAnswers,
} from '@/domain/marking/auto-mark';
import { getQuestionMarks } from '@/domain/remarks/remarks';
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

  // 4. Fetch the questions to display, scoped to the submission's dealt variant
  // (denormalized onto the submission at submit time). Legacy submissions with a
  // null variant fall back to the whole round pool.
  const roundQuestions = await loadSittingQuestions(
    { variantQuestionIds: submissionData.submission.variantQuestionIds as string[] | null },
    roundId
  );

  const { submission, result } = submissionData;

  // Reassemble the stored answers before reading any of them by `q.id`: a
  // matching question is ONE aggregated JSON payload under its base question id
  // (the uuid `question_id` column can hold nothing else), and any legacy
  // per-pair `${q.id}_${index}` entries are folded back into it. Reading the raw
  // map instead made every matching answer look absent and score 0.
  const studentAnswers = reassembleAnswers(
    submission.answersJson as Record<string, unknown> | null
  );

  // Per-question marks come from the same pipeline the appeal dialog uses (a
  // resolved remark wins, then the educator's mark for free text, then the
  // auto-marker), so the marks shown here always add up to the stored score and
  // matching questions render their proportional credit.
  const questionMarks = await getQuestionMarks(submission.id);
  const markByQuestion = new Map(questionMarks.map((m) => [m.questionId, m]));

  // Single denominator source of truth: the round's fixed target total (via
  // getRoundTotalMarks), so the displayed percentage matches advancement rather
  // than a per-variant SUM(marks). Rounds with no computable total (e.g. paper
  // rounds with an empty bank) fall back to the raw mark alone.
  const totals = await getRoundTotalMarks([roundId]);
  const totalMarks = totals.get(roundId) ?? 0;
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
            const mark = markByQuestion.get(q.id);
            const rawAnswer = studentAnswers[q.id];
            const maxMarks = q.marks ?? 0;
            const awarded = mark?.marks ?? 0;
            const isFreeText = q.questionType === 'free_text';
            const isMatching = q.questionType === 'matching';
            const hasAnswer = rawAnswer !== undefined && rawAnswer !== '';

            // Free text is educator-marked, so "0" is not "wrong" until a marker
            // has been entered — say so instead of painting the question red.
            const pendingManual = isFreeText && !mark?.manuallyMarked;
            const fullyCorrect = maxMarks > 0 && awarded >= maxMarks;
            const partlyCorrect = awarded > 0 && !fullyCorrect;

            const badge = pendingManual
              ? { label: 'Awaiting educator', classes: 'bg-amber-100 text-amber-800' }
              : isFreeText
                ? { label: 'Educator-marked', classes: 'bg-amber-100 text-amber-800' }
                : fullyCorrect
                  ? { label: 'Correct', classes: 'bg-green-100 text-green-800' }
                  : partlyCorrect
                    ? { label: 'Partly correct', classes: 'bg-amber-100 text-amber-800' }
                    : { label: 'Incorrect', classes: 'bg-red-100 text-red-800' };

            const pairs = isMatching ? matchingPairsOf(q) : [];
            const selections = isMatching ? getMatchingSelections(rawAnswer) : {};

            return (
              <div key={q.id} className="border border-slate-200 rounded-lg p-6">
                <div className="flex justify-between items-start mb-4 gap-4">
                  <h3 className="font-semibold text-lg text-slate-900">
                    Question {index + 1} <span className="text-sm font-normal text-slate-500 ml-2">({maxMarks} marks)</span>
                  </h3>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="px-3 py-1 rounded-full text-sm font-medium bg-slate-100 text-slate-700">
                      {awarded} / {maxMarks}
                    </span>
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${badge.classes}`}>
                      {badge.label}
                    </span>
                  </div>
                </div>
                
                <p className="text-slate-800 mb-6">{q.prompt}</p>

                {isMatching ? (
                  /* Matching: one row per pair, so a student sees exactly which
                     matches earned the proportional credit above. */
                  <div className="space-y-3">
                    {pairs.length === 0 ? (
                      <div className="bg-slate-50 p-4 rounded-md border border-slate-100 text-slate-500">
                        No pairs are available for this question.
                      </div>
                    ) : (
                      pairs.map((pair: any, pairIndex: number) => {
                        const premise = String(pair?.premise ?? `Pair ${pairIndex + 1}`);
                        const expected = String(pair?.response ?? '');
                        const chosen = selections[pairIndex] ?? '';
                        const isRight =
                          expected !== '' &&
                          chosen.trim().toLowerCase() === expected.trim().toLowerCase();
                        return (
                          <div
                            key={pairIndex}
                            className={`grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-md border ${
                              isRight ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
                            }`}
                          >
                            <div>
                              <div className="text-xs font-semibold text-slate-500 uppercase mb-1">
                                {premise}
                              </div>
                              <div className="text-slate-900">
                                {chosen || 'No match selected'}
                              </div>
                            </div>
                            <div>
                              <div className={`text-xs font-semibold uppercase mb-1 ${isRight ? 'text-green-700' : 'text-red-700'}`}>
                                Correct match
                              </div>
                              <div className={isRight ? 'text-green-900' : 'text-red-900'}>
                                {expected}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-slate-50 p-4 rounded-md border border-slate-100">
                      <div className="text-xs font-semibold text-slate-500 uppercase mb-1">Your Answer</div>
                      <div className="text-slate-900 whitespace-pre-wrap">
                        {hasAnswer ? mark?.studentAnswer ?? String(rawAnswer) : 'No answer provided'}
                      </div>
                    </div>
                    <div className="bg-blue-50 p-4 rounded-md border border-blue-100">
                      <div className="text-xs font-semibold text-blue-700 uppercase mb-1">Correct Answer</div>
                      <div className="text-blue-900 whitespace-pre-wrap">
                        {isFreeText
                          ? 'Marked by your educator'
                          : mark?.correctAnswer ?? String(q.correctAnswer ?? '')}
                      </div>
                    </div>
                  </div>
                )}
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