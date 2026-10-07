import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { rounds, questions, portals } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import PracticeExamInterface from '@/components/student/PracticeExamInterface';

export default async function PracticeTestPage({
  params,
}: {
  params: Promise<{ roundId: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { roundId } = await params;

  const [round] = await db.select().from(rounds).where(eq(rounds.id, roundId));
  if (!round) {
    redirect('/results/past-papers');
  }

  const [portal] = await db.select().from(portals).where(eq(portals.id, round.portalId));

  const qs = await db
    .select()
    .from(questions)
    .where(eq(questions.roundId, roundId));

  if (qs.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 p-8">
        <h1 className="text-2xl font-bold text-slate-800">No Questions Found</h1>
        <p className="mt-4 text-slate-600">This past paper does not have any online questions configured.</p>
      </div>
    );
  }

  const title = `${portal?.name} - ${round.name} (Practice)`;

  // Practice reuses the whole pool as-is; marks are nullable in the schema, so
  // coerce to 0 for the (number-typed) practice interface without changing
  // behavior — PracticeExamInterface already treats a falsy mark as 1.
  const practiceQuestions = qs.map((q) => ({ ...q, marks: q.marks ?? 0 }));

  return (
    <PracticeExamInterface
      questions={practiceQuestions}
      testTitle={title}
    />
  );
}
