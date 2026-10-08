'use server';

import { db } from '@/lib/db';
import { results, studentAnswers, examSittings, questionPapers, submissions, memberships } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { calculateEarnedMarks } from '@/domain/marking/auto-mark';
import { loadSittingQuestions } from '@/domain/question-bank/load-variant';

export async function submitMarksForModeration(
  roundId: string,
  submissionId: string,
  grades: { questionId: string; score: number; feedback: string }[]
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  try {
    // 1. Fetch submission to get studentMembershipId
    const submission = await db.query.submissions.findFirst({
      where: eq(submissions.id, submissionId)
    });
    
    if (!submission || !submission.studentMembershipId) {
      throw new Error('Submission not found or invalid');
    }

    // 2. Fetch student membership to get schoolId
    const studentMembership = await db.query.memberships.findFirst({
      where: eq(memberships.id, submission.studentMembershipId)
    });

    if (!studentMembership) {
      throw new Error('Student membership not found');
    }

    // 3. Verify educator access to this school
    const educatorMembership = await db.query.memberships.findFirst({
      where: and(
        eq(memberships.userId, user.id),
        eq(memberships.schoolId, studentMembership.schoolId!),
        eq(memberships.portalId, studentMembership.portalId),
        eq(memberships.role, 'educator'),
        eq(memberships.status, 'accepted')
      )
    });

    if (!educatorMembership) {
      throw new Error('Unauthorized: You are not an educator for this school.');
    }

    // 4. Find question paper for this round
    const paper = await db.query.questionPapers.findFirst({
      where: eq(questionPapers.roundId, roundId)
    });

    if (!paper) {
      throw new Error('Question paper not found for this round');
    }

    // 5. Find or create exam_sitting
    let sitting = await db.query.examSittings.findFirst({
      where: and(
        eq(examSittings.studentMembershipId, submission.studentMembershipId),
        eq(examSittings.questionPaperId, paper.id)
      )
    });

    if (!sitting) {
      const [newSitting] = await db.insert(examSittings).values({
        studentMembershipId: submission.studentMembershipId,
        questionPaperId: paper.id,
        status: 'submitted',
        startedAt: submission.startedAt || new Date(),
        endedAt: submission.submittedAt || new Date(),
      }).returning();
      sitting = newSitting;
    }

    // 6. Resolve the questions this entrant was actually dealt (their sitting
    //    variant, or the whole pool for legacy sittings). Grading or auto-marking
    //    anything outside this set would let the score exceed the round's fixed
    //    target (>100%), so out-of-variant questionIds are rejected below.
    const sittingQuestions = await loadSittingQuestions(
      { variantQuestionIds: (submission.variantQuestionIds as string[] | null) ?? null },
      roundId
    );
    const dealtQuestionIds = new Set(sittingQuestions.map((q) => q.id));

    // 7. Upsert student_answers for each grade, skipping any question the
    //    entrant was never dealt.
    let manualScoreTotal = 0;

    for (const grade of grades) {
      if (!dealtQuestionIds.has(grade.questionId)) {
        // Reject an out-of-variant grade rather than silently banking it.
        continue;
      }
      manualScoreTotal += grade.score;

      const existingAnswer = await db.query.studentAnswers.findFirst({
        where: and(
          eq(studentAnswers.sittingId, sitting.id),
          eq(studentAnswers.questionId, grade.questionId)
        )
      });

      if (existingAnswer) {
        await db.update(studentAnswers).set({
          manualScore: grade.score.toString(),
          educatorFeedback: grade.feedback,
        }).where(eq(studentAnswers.id, existingAnswer.id));
      } else {
        await db.insert(studentAnswers).values({
          sittingId: sitting.id,
          questionId: grade.questionId,
          answerValue: '',
          manualScore: grade.score.toString(),
          educatorFeedback: grade.feedback,
        });
      }
    }

    // 8. Calculate total score including auto-marked MCQs, scoped to the dealt
    //    variant only (never the whole round pool).
    let totalScore = manualScoreTotal;
    if (submission.submissionType === 'online' && submission.answersJson) {
      const answersObj = submission.answersJson as Record<string, string>;

      for (const q of sittingQuestions) {
        if (q.questionType !== 'free_text') {
          totalScore += calculateEarnedMarks(q, answersObj[q.id]);
        }
      }
    }

    // 8. Upsert results table
    const existingResult = await db.query.results.findFirst({
      where: eq(results.submissionId, submissionId)
    });

    if (existingResult) {
      await db.update(results).set({
        score: totalScore.toString(),
        status: 'moderated',
        gradedByMembershipId: educatorMembership.id,
      }).where(eq(results.id, existingResult.id));
    } else {
      await db.insert(results).values({
        submissionId: submissionId,
        score: totalScore.toString(),
        status: 'moderated',
        gradedByMembershipId: educatorMembership.id,
      });
    }

    return { success: true };
  } catch (err: any) {
    console.error('Failed to submit marks:', err);
    return { error: err.message || 'Failed to submit marks' };
  }
}
