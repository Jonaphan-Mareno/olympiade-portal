import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  examSittings,
  memberships,
  questionPapers,
  questions,
  studentAnswers,
  submissions,
  results,
} from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { autoMarkAnswer, isAutoMarkable } from '@/lib/marking';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { sittingId } = await request.json();
    if (!sittingId) return NextResponse.json({ error: 'Missing sittingId' }, { status: 400 });

    const [row] = await db
      .select({ sitting: examSittings, membership: memberships, paper: questionPapers })
      .from(examSittings)
      .innerJoin(memberships, eq(memberships.id, examSittings.studentMembershipId))
      .innerJoin(questionPapers, eq(questionPapers.id, examSittings.questionPaperId))
      .where(and(eq(examSittings.id, sittingId), eq(memberships.userId, user.id)))
      .limit(1);

    if (!row) return NextResponse.json({ error: 'Sitting not found' }, { status: 404 });
    if (row.sitting.status !== 'active') return NextResponse.json({ success: true });

    const deadline = row.sitting.startedAt.getTime() + (row.paper.durationMinutes ?? 60) * 60_000;
    const endedAt = new Date();
    await db.update(examSittings)
      .set({ status: 'submitted', endedAt })
      .where(eq(examSittings.id, sittingId));

    const [roundQuestions, answers] = await Promise.all([
      db.select().from(questions).where(eq(questions.roundId, row.paper.roundId)),
      db.select().from(studentAnswers).where(eq(studentAnswers.sittingId, sittingId)),
    ]);

    const answerMap = new Map(answers.filter(a => a.questionId).map(a => [a.questionId!, a.answerValue]));
    let autoScore = 0;
    let hasManual = false;

    for (const question of roundQuestions) {
      if (isAutoMarkable(question.questionType)) {
        autoScore += autoMarkAnswer(question, answerMap.get(question.id)) ?? 0;
      } else {
        hasManual = true;
      }
    }

    const submission = await db.insert(submissions).values({
      roundId: row.paper.roundId,
      studentMembershipId: row.sitting.studentMembershipId,
      submissionType: 'online',
      answersJson: { __sittingId: sittingId, ...Object.fromEntries(answerMap) },
      startedAt: row.sitting.startedAt,
      submittedAt: endedAt,
      status: 'submitted',
    }).returning({ id: submissions.id });

    const [result] = await db.insert(results).values({
      submissionId: submission[0].id,
      score: String(autoScore),
      status: hasManual ? 'queued_for_marker' : 'auto_marked',
    }).returning({ id: results.id, status: results.status, score: results.score });

    return NextResponse.json({
      success: true,
      resultId: result.id,
      status: result.status,
      score: result.score,
      timeExpired: Date.now() >= deadline,
    });
  } catch (error) {
    console.error('Error submitting sitting:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
