import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { examSittings, memberships, questionPapers, studentAnswers, questions } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { sittingId, questionId, answerValue } = body;
    if (!sittingId || !questionId || typeof answerValue !== 'string') {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const [row] = await db.select({ sitting: examSittings, membership: memberships, paper: questionPapers })
      .from(examSittings)
      .innerJoin(memberships, eq(memberships.id, examSittings.studentMembershipId))
      .innerJoin(questionPapers, eq(questionPapers.id, examSittings.questionPaperId))
      .where(and(eq(examSittings.id, sittingId), eq(memberships.userId, user.id)))
      .limit(1);

    if (!row) return NextResponse.json({ error: 'Sitting not found' }, { status: 404 });
    if (row.sitting.status !== 'active') return NextResponse.json({ error: 'Exam sitting is not active' }, { status: 400 });

    const deadline = row.sitting.startedAt.getTime() + (row.paper.durationMinutes ?? 60) * 60_000;
    if (Date.now() >= deadline) {
      await db.update(examSittings).set({ status: 'submitted', endedAt: new Date() }).where(eq(examSittings.id, sittingId));
      return NextResponse.json({ error: 'Time has expired' }, { status: 400 });
    }

    const [question] = await db.select().from(questions).where(eq(questions.id, questionId)).limit(1);
    if (!question || question.roundId !== row.paper.roundId) {
      return NextResponse.json({ error: 'Question does not belong to this test' }, { status: 400 });
    }

    await db.insert(studentAnswers).values({
      sittingId,
      questionId,
      answerValue,
      savedAt: new Date(),
    }).onConflictDoUpdate({
      target: [studentAnswers.sittingId, studentAnswers.questionId],
      set: { answerValue, savedAt: new Date() },
    });

    return NextResponse.json({ success: true, savedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Error saving answer:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
