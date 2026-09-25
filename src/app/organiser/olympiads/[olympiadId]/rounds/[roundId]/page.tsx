import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  rounds,
  questions,
  questionPapers,
  examSittings,
} from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import QuestionBuilder from '@/components/organiser/QuestionBuilder';
import { updateRound } from './actions';
import { deriveRoundState } from '@/domain/rounds/round-state-machine';
import PublishResultsButton from './PublishResultsButton';
import { SubmitButton } from '@/components/SubmitButton';
import RoundFormInputs from '@/components/organiser/RoundFormInputs';
import DeleteRoundButton from './DeleteRoundButton';
import GenerateTestButton from './GenerateTestButton';
import BroadcastNotificationButton from './BroadcastNotificationButton';

export default async function ManageRoundPage({
  params,
}: {
  params: Promise<{ olympiadId: string; roundId: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { olympiadId, roundId } = await params;

  const [round] = await db.select().from(rounds).where(eq(rounds.id, roundId));

  if (!round) {
    return <div>Round not found.</div>;
  }

  const roundState = deriveRoundState(round);

  const dbQuestions = await db
    .select()
    .from(questions)
    .where(eq(questions.roundId, roundId));

  const initialQuestions = dbQuestions.map((q) => ({
    id: q.id,
    type: q.questionType,
    prompt: q.prompt,
    marks: q.marks,
    options: q.options,
    correctAnswer: q.correctAnswer,
  }));

  const opensAtLocal = new Date(
    round.opensAt.getTime() - round.opensAt.getTimezoneOffset() * 60000
  )
    .toISOString()
    .slice(0, 16);
  const closesAtLocal = new Date(
    round.closesAt.getTime() - round.closesAt.getTimezoneOffset() * 60000
  )
    .toISOString()
    .slice(0, 16);

  let hasLiveSittings = false;
  let durationMinutes = 60;
  let questionPaperUrl = '';
  let answerKeyUrl = '';
  
  const paper = await db
    .select()
    .from(questionPapers)
    .where(eq(questionPapers.roundId, roundId))
    .limit(1);

  if (paper && paper.length > 0) {
    durationMinutes = paper[0].durationMinutes ?? 60;
    questionPaperUrl = paper[0].fileUrl || '';
    
    // Attempt to extract answer key url from answerKeyJson if it exists
    if (paper[0].answerKeyJson) {
      if (typeof paper[0].answerKeyJson === 'object') {
        const parsedJson = paper[0].answerKeyJson as any;
        if (parsedJson.memoUrl) answerKeyUrl = parsedJson.memoUrl;
      }
    }

    if (round.deliveryMethod === 'online' || round.deliveryMethod === 'hybrid') {
      const sittings = await db
        .select()
        .from(examSittings)
        .where(eq(examSittings.questionPaperId, paper[0].id))
        .limit(1);
      hasLiveSittings = sittings.length > 0;
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4 md:px-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Link
            href={`/organiser/olympiads/${olympiadId}`}
            className="text-blue-600 hover:underline text-sm font-medium mb-4 inline-block"
          >
            &larr; Back to Olympiad
          </Link>
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold text-slate-900 m-0">
                Manage Round
              </h1>
              <span
              style={{
                display: 'inline-block',
                fontSize: '0.75rem',
                fontWeight: 600,
                padding: '0.25rem 0.75rem',
                borderRadius: '9999px',
              }}
              className={
                roundState === 'scheduled'
                  ? 'bg-slate-100 text-slate-700'
                  : roundState === 'open'
                    ? 'bg-green-100 text-green-800'
                    : roundState === 'closed'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-blue-100 text-blue-800'
              }
            >
              {roundState}
            </span>
            </div>
            <BroadcastNotificationButton portalId={olympiadId} roundId={roundId} />
          </div>
          <p className="text-slate-600 text-lg mb-6">
            Update round details and edit questions.
          </p>
          <div className="flex gap-4 border-b border-slate-200">
            <Link href={`/organiser/olympiads/${olympiadId}/rounds/${roundId}`} className="pb-3 text-sm font-bold uppercase tracking-wider border-b-2 border-slate-900 text-slate-900">
              Manage Round
            </Link>
            <Link href={`/organiser/olympiads/${olympiadId}/rounds/${roundId}/certificate`} className="pb-3 text-sm font-bold uppercase tracking-wider border-b-2 border-transparent text-slate-500 hover:text-slate-700">
              Certificates
            </Link>
            <Link href={`/organiser/olympiads/${olympiadId}/rounds/${roundId}/remarks`} className="pb-3 text-sm font-bold uppercase tracking-wider border-b-2 border-transparent text-slate-500 hover:text-slate-700">
              Remarks
            </Link>
          </div>
        </div>

        <form action={updateRound} className="space-y-8">
          <input type="hidden" name="portalId" value={olympiadId} />
          <input type="hidden" name="roundId" value={roundId} />
          <input
            type="hidden"
            name="deliveryMethod"
            value={round.deliveryMethod}
          />

          {/* Section 1: Round Details */}
          <div className="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-slate-200">
            <h2 className="text-xl font-bold text-slate-900 mb-6 border-b border-slate-100 pb-3">
              Round Details
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-2">
                <label
                  className="block text-sm font-semibold text-slate-900 mb-2"
                  htmlFor="name"
                >
                  Round Name
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  required
                  defaultValue={round.name}
                  className="w-full p-3 border border-slate-300 rounded-md text-slate-900 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>
              <div className="md:col-span-1">
                <label
                  className="block text-sm font-semibold text-slate-900 mb-2"
                  htmlFor="orderIndex"
                >
                  Round Order
                </label>
                <input
                  type="number"
                  id="orderIndex"
                  name="orderIndex"
                  min="1"
                  required
                  defaultValue={round.orderIndex}
                  className="w-full p-3 border border-slate-300 rounded-md text-slate-900 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>
              <RoundFormInputs 
                defaultOpensAt={opensAtLocal} 
                defaultClosesAt={closesAtLocal} 
                defaultDuration={durationMinutes} 
                isOnline={round.deliveryMethod === 'online'} 
              />
            </div>
          </div>

          {/* Section 2: Question Builder or Uploads */}
          <div className="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-slate-200">
            {round.deliveryMethod === 'paper' || round.deliveryMethod === 'hybrid' ? (
              <div>
                <h2 className="text-xl font-bold text-slate-900 mb-2 border-b border-slate-100 pb-3">
                  Upload Documents
                </h2>
                <div className="space-y-6 mt-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">Question Paper PDF</label>
                    {questionPaperUrl ? (
                      <div className="mb-2 text-sm text-slate-600">
                        Current file: <a href={questionPaperUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">View Document</a>
                      </div>
                    ) : null}
                    <input type="file" name="questionPaper" accept=".pdf" className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
                    <p className="text-xs text-slate-500 mt-1">Upload a new PDF to replace the current file. Leave empty to keep the existing file.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">Answer Key Memo (PDF)</label>
                    {answerKeyUrl ? (
                      <div className="mb-2 text-sm text-slate-600">
                        Current file: <a href={answerKeyUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">View Document</a>
                      </div>
                    ) : null}
                    <input type="file" name="answerKey" accept=".pdf" className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
                    <p className="text-xs text-slate-500 mt-1">Upload a new PDF to replace the current answer key. Leave empty to keep the existing file.</p>
                  </div>
                </div>
              </div>
            ) : null}

            {(round.deliveryMethod === 'online' || round.deliveryMethod === 'hybrid') && (
              <div className={round.deliveryMethod === 'hybrid' ? 'mt-12 pt-8 border-t border-slate-200' : ''}>
                {hasLiveSittings ? (
                  <div>
                    <h2 className="text-xl font-bold text-slate-900 mb-2 border-b border-slate-100 pb-3">
                      Questions (Read Only)
                    </h2>
                    <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-md mb-6 font-medium">
                      This round cannot be edited because students have already
                      begun their attempts.
                    </div>
                    <div className="opacity-70 pointer-events-none">
                      <QuestionBuilder initialQuestions={initialQuestions} />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-3 mb-6 gap-4">
                      <h2 className="text-xl font-bold text-slate-900 m-0">
                        Question Builder
                      </h2>
                      {round.deliveryMethod === 'hybrid' && questionPaperUrl && initialQuestions.length === 0 && (
                        <div className="sm:w-auto w-full">
                          <GenerateTestButton roundId={roundId} olympiadId={olympiadId} />
                        </div>
                      )}
                    </div>
                    {round.deliveryMethod === 'hybrid' && initialQuestions.length > 0 && (
                      <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-md mb-6 text-sm flex gap-2 items-start">
                        <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div>
                          <strong>AI-Generated Test.</strong> Please review all questions for formatting accuracy and manually upload any required diagrams or images.
                        </div>
                      </div>
                    )}
                    <QuestionBuilder initialQuestions={initialQuestions} />
                  </>
                )}
              </div>
            )}
          </div>

          {/* Section 3: Results publication */}
          {(roundState === 'closed' || roundState === 'released') && (
            <div className="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-slate-200">
              <h2 className="text-xl font-bold text-slate-900 mb-2 border-b border-slate-100 pb-3">
                Results
              </h2>
              {roundState === 'released' ? (
                <p className="text-slate-700">
                  Results were published on{' '}
                  <strong>
                    {round.resultsPublishedAt?.toLocaleString() ?? 'unknown'}
                  </strong>
                  . Educators and entrants have been notified; any failed sends
                  are retried automatically by the daily reminder sweep.
                </p>
              ) : (
                <div className="space-y-4">
                  <p className="text-slate-700">
                    This round has closed. Publishing the results emails every
                    educator a school-level summary and every entrant who
                    submitted their own result.
                  </p>
                  <PublishResultsButton
                    portalId={olympiadId}
                    roundId={roundId}
                  />
                </div>
              )}
            </div>
          )}

          <div className="flex justify-between items-center pt-4">
            <div>
              {roundState === 'scheduled' && (
                <DeleteRoundButton roundId={roundId} olympiadId={olympiadId} />
              )}
            </div>
            <SubmitButton
              pendingText="Saving…"
              fullWidth={false}
              disabled={hasLiveSittings}
              className="bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed hover:bg-blue-800 text-white border-none rounded-lg py-4 px-10 text-lg font-bold shadow-md transition-all"
            >
              Save Changes
            </SubmitButton>
          </div>
        </form>
      </div>
    </div>
  );
}
