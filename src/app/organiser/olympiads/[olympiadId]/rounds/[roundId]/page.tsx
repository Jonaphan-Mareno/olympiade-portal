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
  if (round.deliveryMethod === 'online') {
    const paper = await db
      .select()
      .from(questionPapers)
      .where(eq(questionPapers.roundId, roundId))
      .limit(1);
    if (paper && paper.length > 0) {
      durationMinutes = paper[0].durationMinutes ?? 60;
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
          <h1 className="text-3xl font-bold text-slate-900 mb-2">
            Manage Round
          </h1>
          <p className="text-slate-600 text-lg">
            Update round details and edit questions.
          </p>
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
              <div className="md:col-span-1">
                <label
                  className="block text-sm font-semibold text-slate-900 mb-2"
                  htmlFor="opensAt"
                >
                  Opening Time
                </label>
                <input
                  type="datetime-local"
                  id="opensAt"
                  name="opensAt"
                  required
                  defaultValue={opensAtLocal}
                  className="w-full p-3 border border-slate-300 rounded-md text-slate-900 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>
              {round.deliveryMethod === 'online' && (
                <div className="md:col-span-1">
                  <label className="block text-sm font-semibold text-slate-900 mb-2" htmlFor="durationMinutes">
                    Test Time Limit (minutes)
                  </label>
                  <input type="number" id="durationMinutes" name="durationMinutes" min="1" max="1440" required defaultValue={durationMinutes} className="w-full p-3 border border-slate-300 rounded-md text-slate-900 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                </div>
              )}
              <div className="md:col-span-1">
                <label
                  className="block text-sm font-semibold text-slate-900 mb-2"
                  htmlFor="closesAt"
                >
                  Closing Time
                </label>
                <input
                  type="datetime-local"
                  id="closesAt"
                  name="closesAt"
                  required
                  defaultValue={closesAtLocal}
                  className="w-full p-3 border border-slate-300 rounded-md text-slate-900 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Question Builder or Notice */}
          <div className="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-slate-200">
            {round.deliveryMethod === 'paper' ? (
              <div>
                <h2 className="text-xl font-bold text-slate-900 mb-2 border-b border-slate-100 pb-3">
                  Paper Uploads
                </h2>
                <p className="text-slate-700">
                  This round uses a Paper delivery method. Editing paper files
                  is not currently supported via this interface. Please create a
                  new round to replace it if necessary.
                </p>
              </div>
            ) : hasLiveSittings ? (
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
                <h2 className="text-xl font-bold text-slate-900 mb-6 border-b border-slate-100 pb-3">
                  Question Builder
                </h2>
                <QuestionBuilder initialQuestions={initialQuestions} />
              </>
            )}
          </div>

          <div className="flex justify-end pt-4">
            <button
              type="submit"
              disabled={hasLiveSittings}
              className="bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed hover:bg-blue-800 text-white border-none rounded-lg py-4 px-10 text-lg font-bold shadow-md transition-all"
            >
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
