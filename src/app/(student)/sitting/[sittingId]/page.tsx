import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { examSittings, questionPapers, rounds, studentAnswers, questions } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import ExamInterface from '@/components/student/ExamInterface';

export default async function SittingPage({
  params,
}: {
  params: Promise<{ sittingId: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { sittingId } = await params;

  // Verify sitting
  const [sitting] = await db
    .select()
    .from(examSittings)
    .where(eq(examSittings.id, sittingId));

  if (!sitting) {
    return <div>Sitting not found.</div>;
  }

  if (sitting.status !== 'active') {
    return <div>This exam sitting is no longer active.</div>;
  }

  // Get paper and round info
  const [paper] = await db
    .select()
    .from(questionPapers)
    .where(eq(questionPapers.id, sitting.questionPaperId));

  if (!paper) {
    return <div>Question paper not found.</div>;
  }

  const [round] = await db
    .select()
    .from(rounds)
    .where(eq(rounds.id, paper.roundId));

  // Get initial answers from DB to hydrate state
  const answers = await db
    .select()
    .from(studentAnswers)
    .where(eq(studentAnswers.sittingId, sittingId));

  const initialAnswers: Record<string, string> = {};
  answers.forEach((ans) => {
    if (ans.questionId) {
      initialAnswers[ans.questionId] = ans.answerValue;
    }
  });

  // Get questions from DB
  const questionsData = await db
    .select()
    .from(questions)
    .where(eq(questions.roundId, paper.roundId));

  return (
    <div className="min-h-screen bg-slate-50">
      <ExamInterface
        sittingId={sitting.id}
        durationMinutes={paper.durationMinutes || 60}
        startedAt={sitting.startedAt.toISOString()}
        initialAnswers={initialAnswers}
        questions={questionsData as any}
        testTitle={round?.name || 'Online Olympiad Exam'}
      />
    </div>
  );
}
