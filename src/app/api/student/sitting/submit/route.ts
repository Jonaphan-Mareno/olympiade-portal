import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  examSittings,
  memberships,
  questionPapers,
  submissions,
  studentAnswers,
  questions,
  results,
} from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

// Helper to normalize and compare student answers against various jsonb formats
function isAnswerCorrect(correct: any, studentAns: string | undefined): boolean {
  if (!studentAns || correct === null || correct === undefined) return false;

  const sVal = studentAns.trim();

  // Simple string or quoted string (e.g. "A" or "\"A\"")
  if (typeof correct === 'string') {
    return sVal.toLowerCase() === correct.replace(/^"|"$/g, '').trim().toLowerCase();
  }

  // Numbers or booleans (e.g. true / 42)
  if (typeof correct === 'number' || typeof correct === 'boolean') {
    return sVal.toLowerCase() === String(correct).toLowerCase();
  }

  // Array of valid options (e.g. ["A"])
  if (Array.isArray(correct)) {
    return correct.some((c) => String(c).trim().toLowerCase() === sVal.toLowerCase());
  }

  // Object wrapper (e.g. { value: "A" } or { answer: "A" })
  if (typeof correct === 'object') {
    const val = correct.value ?? correct.answer ?? correct.key;
    if (val !== undefined) {
      return String(val).trim().toLowerCase() === sVal.toLowerCase();
    }
  }

  return JSON.stringify(correct) === sVal;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { sittingId } = await request.json();
    if (!sittingId) return NextResponse.json({ error: 'Missing sittingId' }, { status: 400 });

    // 1. Fetch the exam sitting and paper details
    const [sittingData] = await db
      .select({
        sitting: examSittings,
        paper: questionPapers,
        membershipId: memberships.id,
      })
      .from(examSittings)
      .innerJoin(memberships, eq(memberships.id, examSittings.studentMembershipId))
      .innerJoin(questionPapers, eq(questionPapers.id, examSittings.questionPaperId))
      .where(and(eq(examSittings.id, sittingId), eq(memberships.userId, user.id)))
      .limit(1);

    if (!sittingData) return NextResponse.json({ error: 'Sitting not found' }, { status: 404 });
    if (sittingData.sitting.status !== 'active') return NextResponse.json({ success: true });

    // 2. Mark the test sitting as submitted
    await db
      .update(examSittings)
      .set({ status: 'submitted', endedAt: new Date() })
      .where(eq(examSittings.id, sittingId));

    // 3. Fetch all saved answers for this sitting
    const savedAnswers = await db
      .select()
      .from(studentAnswers)
      .where(eq(studentAnswers.sittingId, sittingId));

    // Build lookup map: questionId -> student's answerValue
    const answersObj: Record<string, string> = {};
    for (const ans of savedAnswers) {
      if (ans.questionId) {
        answersObj[ans.questionId] = ans.answerValue;
      }
    }

    // 4. Create or update the submission row
    const [existingSubmission] = await db
      .select()
      .from(submissions)
      .where(
        and(
          eq(submissions.studentMembershipId, sittingData.membershipId),
          eq(submissions.roundId, sittingData.paper.roundId)
        )
      )
      .limit(1);

    let submissionId = existingSubmission?.id;

    if (!existingSubmission) {
      const [newSub] = await db
        .insert(submissions)
        .values({
          studentMembershipId: sittingData.membershipId,
          roundId: sittingData.paper.roundId,
          status: 'submitted',
          submissionType: 'online',
          startedAt: sittingData.sitting.startedAt,
          submittedAt: new Date(),
          answersJson: answersObj,
        })
        .returning({ id: submissions.id });

      submissionId = newSub.id;
    } else {
      await db
        .update(submissions)
        .set({
          status: 'submitted',
          submittedAt: new Date(),
          answersJson: answersObj,
        })
        .where(eq(submissions.id, existingSubmission.id));
    }

    // 5. Automarking: Fetch the round's questions and compare against student answers
    if (submissionId) {
      const roundQuestions = await db
        .select()
        .from(questions)
        .where(eq(questions.roundId, sittingData.paper.roundId));

      let totalScore = 0;
      let maxMarks = 0;

      for (const q of roundQuestions) {
        const questionMarks = q.marks ?? 1;
        maxMarks += questionMarks;

        const studentAns = answersObj[q.id];
        if (isAnswerCorrect(q.correctAnswer, studentAns)) {
          totalScore += questionMarks;
        }
      }

      // 6. Record or update the grade in the results table
      const [existingResult] = await db
        .select()
        .from(results)
        .where(eq(results.submissionId, submissionId))
        .limit(1);

      const resultPayload = {
        submissionId,
        score: totalScore.toString(),
        feedback: `Auto-marked: ${totalScore} / ${maxMarks}`,
        status: 'auto_marked' as const,
      };

      if (!existingResult) {
        await db.insert(results).values(resultPayload);
      } else {
        await db
          .update(results)
          .set(resultPayload)
          .where(eq(results.id, existingResult.id));
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error submitting sitting:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}