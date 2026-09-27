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

function calculateEarnedMarks(q: any, studentAnsRaw: string | undefined): number {
  const maxMarks = q.marks ?? 1;
  if (q.questionType === 'free_text') return 0; // Handled by educators
  if (!studentAnsRaw) return 0;

  if (q.questionType === 'matching') {
     let studentAnsObj: any = {};
     try { studentAnsObj = JSON.parse(studentAnsRaw); } catch {}
     if (typeof studentAnsObj !== 'object') return 0;

     let correctPairs = 0;
     let totalPairs = 0;
     if (Array.isArray(q.options)) {
        q.options.forEach((opt: any, index: number) => {
           totalPairs++;
           if (studentAnsObj[`${q.id}_${index}`] === opt.response) {
               correctPairs++;
           }
        });
     }
     if (totalPairs === 0) return 0;
     return (correctPairs / totalPairs) * maxMarks;
  }

  // Common correct answer normalization
  let correctSelections: string[] = [];
  const strCorrect = typeof q.correctAnswer === 'string' || typeof q.correctAnswer === 'number' || typeof q.correctAnswer === 'boolean' ? String(q.correctAnswer) : '';
  try {
      const parsed = JSON.parse(strCorrect);
      correctSelections = Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
  } catch {
      if (!strCorrect.startsWith('[')) {
          correctSelections = strCorrect.split(',').map((s: string) => s.trim()).filter(Boolean);
      } else {
          correctSelections = [strCorrect];
      }
  }
  if (Array.isArray(q.correctAnswer)) {
      correctSelections = q.correctAnswer.map(String);
  } else if (typeof q.correctAnswer === 'object' && q.correctAnswer !== null && (q.correctAnswer as any).text !== undefined) {
      correctSelections = [String((q.correctAnswer as any).text)];
  }

  let studentSelections: string[] = [];
  try {
      const parsed = JSON.parse(studentAnsRaw);
      studentSelections = Array.isArray(parsed) ? parsed.map(String) : [String(studentAnsRaw)];
  } catch {
      studentSelections = [studentAnsRaw];
  }

  if (q.questionType === 'multiple_choice') {
      const totalCorrect = correctSelections.length;
      if (totalCorrect === 0) return 0;
      let matches = 0;
      studentSelections.forEach(s => {
          if (correctSelections.includes(s)) matches++;
      });
      return (matches / totalCorrect) * maxMarks;
  }

  // single_choice or true_false
  const isCorrect = correctSelections.length === 1 && studentSelections.length === 1 && correctSelections[0] === studentSelections[0];
  if (isCorrect) return maxMarks;
  
  const studentStr = studentSelections.join(',').toLowerCase();
  const correctStr = correctSelections.join(',').toLowerCase();
  if (studentStr === correctStr) return maxMarks;

  return 0;
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
        if (q.questionType === 'free_text') continue; // Do not include educator-marked questions in auto-marked maxMarks

        const questionMarks = q.marks ?? 1;
        maxMarks += questionMarks;

        const studentAns = answersObj[q.id];
        totalScore += calculateEarnedMarks(q, studentAns);
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