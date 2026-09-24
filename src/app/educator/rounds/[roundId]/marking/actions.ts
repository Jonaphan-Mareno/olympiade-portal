'use server';

import { db } from '@/lib/db';
import { results, studentAnswers, examSittings, questionPapers, submissions, memberships, questions } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

function isAnswerCorrect(correct: any, studentAns: string | undefined): boolean {
  if (!studentAns || correct === null || correct === undefined) return false;
  const sVal = studentAns.trim();
  if (typeof correct === 'string') return sVal.toLowerCase() === correct.replace(/^"|"$/g, '').trim().toLowerCase();
  if (typeof correct === 'number' || typeof correct === 'boolean') return sVal.toLowerCase() === String(correct).toLowerCase();
  if (Array.isArray(correct)) return correct.some((c) => String(c).trim().toLowerCase() === sVal.toLowerCase());
  if (typeof correct === 'object') {
    const val = correct.value ?? correct.answer ?? correct.key;
    if (val !== undefined) return String(val).trim().toLowerCase() === sVal.toLowerCase();
  }
  return JSON.stringify(correct) === sVal;
}

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

    // 6. Upsert student_answers for each grade
    let manualScoreTotal = 0;
    const manualScoresMap = new Map<string, number>();
    
    for (const grade of grades) {
      manualScoreTotal += grade.score;
      manualScoresMap.set(grade.questionId, grade.score);
      
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

    // 7. Calculate total score including auto-marked MCQs
    let totalScore = manualScoreTotal;
    if (submission.submissionType === 'online' && submission.answersJson) {
      // Re-evaluate MCQs based on answersJson
      const roundQuestions = await db.query.questions.findMany({
        where: eq(questions.roundId, roundId)
      });
      const answersObj = submission.answersJson as Record<string, string>;
      
      for (const q of roundQuestions) {
        if (q.questionType !== 'free_text') {
          const studentAns = answersObj[q.id];
          if (isAnswerCorrect(q.correctAnswer, studentAns)) {
            totalScore += (q.marks ?? 1);
          }
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
        status: 'queued_for_marker',
        gradedByMembershipId: educatorMembership.id,
      }).where(eq(results.id, existingResult.id));
    } else {
      await db.insert(results).values({
        submissionId: submissionId,
        score: totalScore.toString(),
        status: 'queued_for_marker',
        gradedByMembershipId: educatorMembership.id,
      });
    }

    revalidatePath(`/educator/rounds/${roundId}/marking`);
    return { success: true };
  } catch (err: any) {
    console.error('Failed to submit marks:', err);
    return { error: err.message || 'Failed to submit marks' };
  }
}
