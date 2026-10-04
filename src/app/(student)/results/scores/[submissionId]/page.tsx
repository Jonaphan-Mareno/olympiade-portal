import { createClient } from '@/lib/supabase/server';
import { redirect, notFound } from 'next/navigation';
import { db } from '@/lib/db';
import {
  memberships,
  submissions,
  results,
  users,
  questions,
  examSittings,
  questionPapers,
  studentAnswers,
  rounds,
  portals,
  remarkRequests,
} from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import Link from 'next/link';
import RemarkSection from './RemarkSection';
import { getRemarkEligibility } from '@/domain/remarks/remarks';
import { formatScoreDisplay } from '@/domain/rounds/score-percentage';
import { calculateEarnedMarks } from '@/domain/marking/auto-mark';

export const dynamic = 'force-dynamic';

export default async function ViewPaperStudentPage({
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

  // Fetch submission and verify it belongs to this student
  const [subData] = await db
    .select({
      submission: submissions,
      result: results,
      roundName: rounds.name,
      roundId: rounds.id,
      resultsPublishedAt: rounds.resultsPublishedAt,
      portalName: portals.name,
    })
    .from(submissions)
    .innerJoin(memberships, eq(submissions.studentMembershipId, memberships.id))
    .leftJoin(results, eq(submissions.id, results.submissionId))
    .innerJoin(rounds, eq(submissions.roundId, rounds.id))
    .innerJoin(portals, eq(rounds.portalId, portals.id))
    .where(
      and(
        eq(submissions.id, submissionId),
        eq(memberships.userId, user.id)
      )
    )
    .limit(1);

  if (!subData) {
    return notFound();
  }

  const [remark] = await db
    .select()
    .from(remarkRequests)
    .where(eq(remarkRequests.submissionId, submissionId));
  const remarkEligibility = getRemarkEligibility({
    resultsPublishedAt: subData.resultsPublishedAt,
    hasScore: subData.result?.score != null,
    hasExistingRequest: Boolean(remark),
  });
  const remarkSection = (
    <RemarkSection
      submissionId={submissionId}
      remark={remark ?? null}
      eligibility={remarkEligibility}
    />
  );
  // A completed remark's per-question marks replace the original marks
  const remarkedMarks =
    remark?.status === 'resolved' && remark.questionMarks
      ? (remark.questionMarks as Record<string, number>)
      : null;

  // If this is a paper/offline submission, we might not have digital questions to show.
  // The user prompt mentioned: "obviously the written test won't be available for viewing like their answers... So regarding the written tests, with the written tests, the learners should be able to [CUT OFF]"
  // For now, if it's paper, we just show a placeholder message.
  if (subData.submission.submissionType !== 'online') {
    return (
      <div className="min-h-screen bg-[#F8FAFC]">
        <div className="max-w-4xl mx-auto px-4 py-12">
          <Link href="/results/scores" className="inline-flex items-center text-blue-600 hover:text-blue-800 font-bold text-sm uppercase tracking-wider mb-8">
            &larr; Back to Results
          </Link>
          <div className="bg-white border-2 border-slate-200 p-12 text-center flex flex-col items-center">
            <span className="text-4xl mb-4">📝</span>
            <h2 className="text-2xl font-serif font-bold text-blue-950 mb-2">Written Exam</h2>
            <p className="text-slate-500 font-medium">
              This was a written exam. Digital review of specific answers is not available for offline tests.
            </p>
            <p className="text-slate-900 font-bold mt-4">
              Your mark: {subData.result?.score ?? 'Not yet marked'}
            </p>
          </div>
          <div className="mt-8">{remarkSection}</div>
        </div>
      </div>
    );
  }

  // Fetch all questions for this round
  const roundQuestions = await db
    .select()
    .from(questions)
    .where(eq(questions.roundId, subData.roundId));

  // Fetch student answers and marks from the sitting
  let savedAnswers: Record<string, any> = {};
  // The sitting for *this* round's paper (a student has one per round)
  const [sittingRow] = await db
    .select({ sitting: examSittings })
    .from(examSittings)
    .innerJoin(questionPapers, eq(questionPapers.id, examSittings.questionPaperId))
    .where(
      and(
        eq(examSittings.studentMembershipId, subData.submission.studentMembershipId!),
        eq(questionPapers.roundId, subData.roundId)
      )
    )
    .limit(1);
  const sitting = sittingRow?.sitting;

  if (sitting) {
    const answersList = await db
      .select()
      .from(studentAnswers)
      .where(eq(studentAnswers.sittingId, sitting.id));

    answersList.forEach((a) => {
      savedAnswers[a.questionId!] = a;
    });
  }

  const answersJson = subData.submission.answersJson as Record<string, string> | null;

  const getStudentAnswerRaw = (questionId: string) => {
    return answersJson?.[questionId] || 'No answer provided';
  };

  const getStudentAnswerFormatted = (questionId: string) => {
    const raw = getStudentAnswerRaw(questionId);
    if (raw === 'No answer provided') return raw;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.join('\n');
    } catch {}
    return String(raw).replace(/,/g, '\n'); // User requested: "Don't separate it by a comma... each option should be on a different line"
  };

  const formatAnswerKey = (correctAnswer: any) => {
    if (!correctAnswer) return 'No specific key provided.';
    if (typeof correctAnswer === 'string') {
      try {
        const parsed = JSON.parse(correctAnswer);
        if (Array.isArray(parsed)) return parsed.join('\n');
      } catch {}
      return correctAnswer.replace(/,/g, '\n');
    }
    if (typeof correctAnswer === 'object') {
      if (Array.isArray(correctAnswer)) return correctAnswer.join('\n');
      if (correctAnswer.text) {
        if (Array.isArray(correctAnswer.text)) return correctAnswer.text.join('\n');
        return String(correctAnswer.text).replace(/,/g, '\n');
      }
      if (correctAnswer.memo) {
        if (Array.isArray(correctAnswer.memo)) return correctAnswer.memo.join('\n');
        return String(correctAnswer.memo).replace(/,/g, '\n');
      }
      return JSON.stringify(correctAnswer, null, 2);
    }
    return String(correctAnswer);
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-20">
      <div className="bg-blue-950 p-6 md:px-12 md:py-8 text-white">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <Link href="/results/scores" className="inline-flex items-center text-blue-300 hover:text-white font-bold text-xs uppercase tracking-wider mb-4 transition-colors">
              &larr; Back to Results
            </Link>
            <h1 className="text-3xl font-serif font-bold mb-2">
              Paper Review
            </h1>
            <p className="text-blue-200">
              {subData.portalName} • {subData.roundName}
            </p>
          </div>
          <div className="bg-blue-900 border border-blue-800 p-4 md:px-8 text-center flex flex-col justify-center">
            <span className="text-blue-300 font-bold text-xs uppercase tracking-widest mb-1 block">
              Final Score
            </span>
            <span className="text-3xl font-bold text-white">
              {formatScoreDisplay(
                subData.result?.score,
                roundQuestions.reduce((total, q) => total + (q.marks ?? 0), 0)
              )}
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto mt-8 px-4 md:px-0 space-y-8">
        {roundQuestions.length === 0 ? (
          <div className="bg-white p-12 text-center border-2 border-slate-200 text-slate-500 font-medium">
            This round has no questions to display.
          </div>
        ) : (
          <div className="space-y-6">
            {roundQuestions.map((q, idx) => {
              // Free-text answers carry the educator's mark; everything else
              // is marked by the same function that produced the stored score
              const isManual = q.questionType === 'free_text';
              const studentAnsRaw = getStudentAnswerRaw(q.id);
              const studentAnsFormatted = getStudentAnswerFormatted(q.id);
              const savedAns = savedAnswers[q.id];
              const rawAwarded =
                remarkedMarks?.[q.id] !== undefined
                  ? Number(remarkedMarks[q.id])
                  : isManual
                    ? Number(savedAns?.manualScore ?? 0)
                    : calculateEarnedMarks(q, answersJson?.[q.id]);
              const awardedMarks = Math.round(rawAwarded * 100) / 100;
              
              return (
                <div key={q.id} className="bg-white border-2 border-slate-200 shadow-sm flex flex-col">
                  <div className="bg-slate-50 border-b-2 border-slate-200 p-4 px-6 flex justify-between items-center">
                    <h3 className="text-blue-950 font-bold uppercase tracking-wider text-sm">
                      Question {idx + 1}
                    </h3>
                    <div className="flex items-center gap-4">
                      <span className={`font-bold text-sm ${awardedMarks > 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {awardedMarks} / {q.marks} Marks
                      </span>
                    </div>
                  </div>

                  <div className="p-6 md:p-8 flex flex-col gap-6">
                    <div>
                      <p className="text-slate-900 text-lg font-medium whitespace-pre-wrap">{q.prompt}</p>
                    </div>

                    {q.questionType === 'multiple_choice' || q.questionType === 'single_choice' || q.questionType === 'true_false' ? (
                      <div className="flex flex-col gap-3 mt-2">
                        {(() => {
                          const parsedOptions = Array.isArray(q.options) ? q.options : (typeof q.options === 'string' ? JSON.parse(q.options || '[]') : []);
                          
                          let studentSelections: string[] = [];
                          if (studentAnsRaw && studentAnsRaw !== 'No answer provided') {
                            try {
                              const parsed = JSON.parse(studentAnsRaw);
                              studentSelections = Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
                            } catch {
                              if (typeof studentAnsRaw === 'string' && !studentAnsRaw.startsWith('[')) {
                                studentSelections = studentAnsRaw.split(',').map(s => String(s).trim()).filter(Boolean);
                              } else {
                                studentSelections = [String(studentAnsRaw)];
                              }
                            }
                          }

                          let correctSelections: string[] = [];
                          if (typeof q.correctAnswer === 'string' || typeof q.correctAnswer === 'number' || typeof q.correctAnswer === 'boolean') {
                            const strVal = String(q.correctAnswer);
                            try {
                              const parsed = JSON.parse(strVal);
                              correctSelections = Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
                            } catch {
                              if (!strVal.startsWith('[')) {
                                correctSelections = strVal.split(',').map(s => String(s).trim()).filter(Boolean);
                              } else {
                                correctSelections = [strVal];
                              }
                            }
                          } else if (typeof q.correctAnswer === 'object' && q.correctAnswer !== null) {
                            if (Array.isArray(q.correctAnswer)) {
                              correctSelections = q.correctAnswer.map(String);
                            } else if ((q.correctAnswer as any).text !== undefined) {
                              correctSelections = [String((q.correctAnswer as any).text)];
                            }
                          }

                          let optionsToRender = parsedOptions;
                          if (q.questionType === 'true_false' && (!parsedOptions || parsedOptions.length === 0)) {
                            optionsToRender = ['True', 'False'];
                          }

                          let allCorrect = true;
                          if (studentSelections.length !== correctSelections.length) {
                            allCorrect = false;
                          } else {
                            const sortedStudent = [...studentSelections].sort();
                            const sortedCorrect = [...correctSelections].sort();
                            allCorrect = sortedStudent.every((val, index) => val.trim().toLowerCase() === sortedCorrect[index].trim().toLowerCase());
                          }

                          return (
                            <>
                              {optionsToRender.map((opt: any, i: number) => {
                                const optionText = String(typeof opt === 'string' ? opt : opt.text || opt);
                                const isSelectedByStudent = studentSelections.some(s => s.trim().toLowerCase() === optionText.trim().toLowerCase());
                                const isActuallyCorrect = correctSelections.some(s => s.trim().toLowerCase() === optionText.trim().toLowerCase());
                                
                                let borderClass = 'border-slate-200';
                                let bgClass = 'bg-white';
                                let icon = null;

                                if (isSelectedByStudent) {
                                  if (isActuallyCorrect) {
                                    borderClass = 'border-green-500';
                                    bgClass = 'bg-green-50';
                                    icon = (
                                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                      </svg>
                                    );
                                  } else {
                                    borderClass = 'border-red-500';
                                    bgClass = 'bg-red-50';
                                    icon = (
                                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                      </svg>
                                    );
                                  }
                                }

                                return (
                                  <div key={i} className={`p-4 border-2 rounded-md flex flex-col md:flex-row md:items-center justify-between gap-4 ${borderClass} ${bgClass}`}>
                                    <div className="flex items-start gap-4">
                                      <div className="mt-1">
                                        <input 
                                          type={q.questionType === 'multiple_choice' ? 'checkbox' : 'radio'} 
                                          readOnly 
                                          checked={isSelectedByStudent} 
                                          className="w-5 h-5 accent-blue-950 pointer-events-none" 
                                        />
                                      </div>
                                      <span className="font-medium text-slate-800 text-lg">{optionText}</span>
                                    </div>
                                    {icon && <span className="flex-shrink-0">{icon}</span>}
                                  </div>
                                );
                              })}
                              
                              {!allCorrect && (
                                <div className="mt-4 p-5 bg-blue-50 border-2 border-blue-200 rounded-md">
                                  <h4 className="text-xs font-bold text-blue-800 uppercase tracking-wider mb-2">
                                    Correct Answer{correctSelections.length > 1 ? 's' : ''}
                                  </h4>
                                  <ul className="list-disc pl-5 text-blue-950 font-medium space-y-1">
                                    {correctSelections.map((c, i) => (
                                      <li key={i}>{c}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    ) : q.questionType === 'matching' ? (
                      <div className="flex flex-col gap-3 mt-2">
                        {(() => {
                          let pairs: any[] = [];
                          try {
                            pairs = typeof q.options === 'string' ? JSON.parse(q.options) : (q.options || []);
                          } catch {}
                          
                          const jsonAnswers = (subData.submission.answersJson || {}) as Record<string, string>;

                          let allCorrect = true;

                          const renderedPairs = pairs.map((p: any, i: number) => {
                            const leftItem = String(p.premise || '');
                            const rightItem = String(p.response || '');
                            const studentMatch = jsonAnswers[`${q.id}_${i}`] ? String(jsonAnswers[`${q.id}_${i}`]) : '';
                            const isCorrectMatch = studentMatch.trim().toLowerCase() === rightItem.trim().toLowerCase();

                            if (!isCorrectMatch) {
                              allCorrect = false;
                            }

                            return (
                              <div key={i} className={`p-5 border-2 rounded-md flex flex-col lg:flex-row lg:items-center justify-between gap-6 ${isCorrectMatch ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'}`}>
                                <div className="flex flex-col md:flex-row md:items-center gap-4 flex-1">
                                  <div className="bg-white border-2 border-slate-200 px-4 py-2 font-bold text-slate-800 rounded shadow-sm w-full md:w-1/3 text-center">
                                    {leftItem}
                                  </div>
                                  <span className="text-slate-400 hidden md:block">&rarr;</span>
                                  <div className={`px-4 py-2 font-medium rounded border-2 shadow-sm w-full md:flex-1 text-center ${isCorrectMatch ? 'bg-white border-green-200 text-green-900' : 'bg-white border-red-200 text-red-900'}`}>
                                    {studentMatch || '(No match selected)'}
                                  </div>
                                </div>
                                <div className="flex flex-col items-end gap-2 lg:w-1/4">
                                  <span className="flex-shrink-0">
                                    {isCorrectMatch ? (
                                      <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                      </svg>
                                    ) : (
                                      <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                      </svg>
                                    )}
                                  </span>
                                </div>
                              </div>
                            )
                          });

                          return (
                            <>
                              {renderedPairs}
                              {!allCorrect && (
                                <div className="mt-4 p-5 bg-blue-50 border-2 border-blue-200 rounded-md">
                                  <h4 className="text-xs font-bold text-blue-800 uppercase tracking-wider mb-2">
                                    Correct Matches
                                  </h4>
                                  <ul className="space-y-2 text-blue-950 font-medium">
                                    {pairs.map((p: any, i: number) => (
                                      <li key={i} className="flex gap-2">
                                        <span className="font-bold">{p.premise}</span>
                                        <span className="opacity-70">&rarr;</span>
                                        <span>{p.response}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className={`border-2 p-5 ${awardedMarks > 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                          <h4 className={`text-xs font-bold uppercase tracking-wider mb-3 ${awardedMarks > 0 ? 'text-green-800' : 'text-red-800'}`}>
                            Your Answer
                          </h4>
                          <p className={`whitespace-pre-wrap font-medium ${awardedMarks > 0 ? 'text-green-950' : 'text-red-950'}`}>
                            {studentAnsFormatted}
                          </p>
                        </div>

                        <div className="bg-blue-50 border-2 border-blue-200 p-5">
                          <h4 className="text-xs font-bold text-blue-800 uppercase tracking-wider mb-3">
                            Correct Answer
                          </h4>
                          <p className="text-blue-950 whitespace-pre-wrap font-medium">
                            {formatAnswerKey(q.correctAnswer)}
                          </p>
                        </div>
                      </div>
                    )}

                    {isManual && savedAns?.educatorFeedback && (
                      <div className="bg-slate-100 border-l-4 border-amber-400 p-5 mt-2">
                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                          Educator Feedback
                        </h4>
                        <p className="text-slate-800 font-medium italic">
                          "{savedAns.educatorFeedback}"
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Remark status, or the option to appeal */}
        {remarkSection}
      </div>
    </div>
  );
}
