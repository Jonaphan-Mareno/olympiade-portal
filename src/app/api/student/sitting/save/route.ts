import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { examSittings, memberships, questionPapers, studentAnswers, questions, rounds } from '@/lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { computeAttemptDeadline } from '@/domain/rounds/attempt-deadline';
import {
  aggregateMatchingAnswer,
  isUuid,
  splitMatchingKey,
} from '@/domain/marking/auto-mark';

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

    // `sitting_id` and `question_id` are uuid columns. A malformed id would
    // otherwise reach Postgres and come back as a 22P02 "invalid input syntax
    // for type uuid" 500, so reject it as the client error it is.
    if (!isUuid(sittingId)) {
      return NextResponse.json({ error: 'Invalid sitting id' }, { status: 400 });
    }

    // Matching sub-answers are posted with a composite key `${questionId}_${index}`
    // (see ExamInterface). Split it into the base question id + pair index
    // BEFORE the DB lookup and BEFORE the variant-membership check, so a
    // legitimate sub-answer is not mistaken for an out-of-variant question.
    const pair = splitMatchingKey(String(questionId));
    const baseQuestionId = pair ? pair.questionId : String(questionId);
    if (!isUuid(baseQuestionId)) {
      return NextResponse.json({ error: 'Invalid question id' }, { status: 400 });
    }

    const [row] = await db.select({ sitting: examSittings, membership: memberships, paper: questionPapers, round: rounds })
      .from(examSittings)
      .innerJoin(memberships, eq(memberships.id, examSittings.studentMembershipId))
      .innerJoin(questionPapers, eq(questionPapers.id, examSittings.questionPaperId))
      .innerJoin(rounds, eq(rounds.id, questionPapers.roundId))
      .where(and(eq(examSittings.id, sittingId), eq(memberships.userId, user.id)))
      .limit(1);

    if (!row) return NextResponse.json({ error: 'Sitting not found' }, { status: 404 });
    if (row.sitting.status !== 'active') return NextResponse.json({ error: 'Exam sitting is not active' }, { status: 400 });

    // The attempt deadline is capped at the round's close, so a student who
    // started late cannot keep saving answers past the published window.
    const deadline = computeAttemptDeadline(
      row.sitting.startedAt,
      row.paper.durationMinutes ?? 60,
      row.round.closesAt
    );
    if (Date.now() >= deadline) {
      await db.update(examSittings).set({ status: 'submitted', endedAt: new Date() }).where(eq(examSittings.id, sittingId));
      return NextResponse.json({ error: 'Time has expired' }, { status: 400 });
    }

    const [question] = await db.select().from(questions).where(eq(questions.id, baseQuestionId)).limit(1);
    if (!question || question.roundId !== row.paper.roundId) {
      return NextResponse.json({ error: 'Question does not belong to this test' }, { status: 400 });
    }

    // RLS is disabled, so this is the only defence against answer smuggling: a
    // dealt variant is authoritative and any question outside it is rejected
    // with a distinct message. Legacy sittings (null variant) keep the
    // round-scoped check above as their only guard.
    const variantIds = row.sitting.variantQuestionIds;
    if (Array.isArray(variantIds) && !variantIds.includes(baseQuestionId)) {
      return NextResponse.json({ error: 'Question is not part of your assigned test' }, { status: 400 });
    }

    // A composite key only ever belongs to a matching question; anything else
    // is a client bug and is rejected rather than silently mis-stored.
    if (pair && question.questionType !== 'matching') {
      return NextResponse.json({ error: 'Question does not accept paired answers' }, { status: 400 });
    }

    // `student_answers.question_id` is a uuid column with a unique
    // (sitting_id, question_id) constraint, so the composite key can NEVER be
    // persisted directly (it fails with 22P02 and the sub-answer is lost). All
    // pairs of a matching question are aggregated into ONE row under the base
    // uuid whose answer_value is the JSON object the auto-marker's matching
    // branch reads: { "<questionUuid>_<pairIndex>": "<chosen response>" }.
    let persistedValue = answerValue;
    if (pair) {
      const [existing] = await db
        .select({ answerValue: studentAnswers.answerValue })
        .from(studentAnswers)
        .where(
          and(
            eq(studentAnswers.sittingId, sittingId),
            eq(studentAnswers.questionId, baseQuestionId)
          )
        )
        .limit(1);
      persistedValue = aggregateMatchingAnswer(
        baseQuestionId,
        existing?.answerValue ?? null,
        pair.index,
        answerValue
      );
    }

    await db.insert(studentAnswers).values({
      sittingId,
      questionId: baseQuestionId,
      answerValue: persistedValue,
      savedAt: new Date(),
    }).onConflictDoUpdate({
      target: [studentAnswers.sittingId, studentAnswers.questionId],
      set: pair
        ? {
            // Merge the pair selections in the database too: ON CONFLICT holds
            // the row lock, so two pairs of the same question saved at the same
            // instant cannot clobber each other. A value that is not a JSON
            // object (e.g. the empty string an educator moderation row seeds)
            // is replaced by the freshly aggregated payload.
            answerValue: sql`CASE
              WHEN ${studentAnswers.answerValue} IS NULL
                OR left(${studentAnswers.answerValue}, 1) <> '{'
              THEN excluded.answer_value
              ELSE (${studentAnswers.answerValue}::jsonb || excluded.answer_value::jsonb)::text
            END`,
            savedAt: new Date(),
          }
        : { answerValue: persistedValue, savedAt: new Date() },
    });

    return NextResponse.json({ success: true, savedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Error saving answer:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
