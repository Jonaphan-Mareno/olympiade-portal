import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { examSittings, questionPapers, rounds, studentAnswers, questions, memberships } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import ExamInterface from '@/components/student/ExamInterface';

export const dynamic = 'force-dynamic';

export default async function SittingPage({ params }: { params: Promise<{ sittingId: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { sittingId } = await params;
  const [row] = await db.select({ sitting: examSittings, paper: questionPapers, membership: memberships })
    .from(examSittings)
    .innerJoin(memberships, eq(memberships.id, examSittings.studentMembershipId))
    .innerJoin(questionPapers, eq(questionPapers.id, examSittings.questionPaperId))
    .where(and(eq(examSittings.id, sittingId), eq(memberships.userId, user.id)))
    .limit(1);

  if (!row) return <div className="p-8 text-slate-700">Sitting not found.</div>;

  const deadline = row.sitting.startedAt.getTime() + (row.paper.durationMinutes ?? 60) * 60_000;
  if (row.sitting.status === 'active' && Date.now() >= deadline) {
    await db.update(examSittings).set({ status: 'submitted', endedAt: new Date() }).where(eq(examSittings.id, sittingId));
    return <div className="max-w-2xl mx-auto p-8 text-center"><h1 className="text-2xl font-bold text-slate-900">Time expired</h1><p className="mt-2 text-slate-600">Your attempt has been submitted automatically.</p></div>;
  }
  if (row.sitting.status !== 'active') {
    return <div className="max-w-2xl mx-auto p-8 text-center"><h1 className="text-2xl font-bold text-slate-900">Attempt submitted</h1><p className="mt-2 text-slate-600">This exam sitting is no longer active.</p></div>;
  }

  const [round] = await db.select().from(rounds).where(eq(rounds.id, row.paper.roundId));
  const answers = await db.select().from(studentAnswers).where(eq(studentAnswers.sittingId, sittingId));
  const initialAnswers: Record<string, string> = {};
  answers.forEach((ans) => { if (ans.questionId) initialAnswers[ans.questionId] = ans.answerValue; });

  const questionsData = await db.select().from(questions).where(eq(questions.roundId, row.paper.roundId));

  return (
    <ExamInterface
      sittingId={row.sitting.id}
      durationMinutes={row.paper.durationMinutes ?? 60}
      startedAt={row.sitting.startedAt.toISOString()}
      initialAnswers={initialAnswers}
      questions={questionsData as any}
      testTitle={round?.name || 'Online Olympiad Exam'}
    />
  );
}
