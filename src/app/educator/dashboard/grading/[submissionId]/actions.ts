'use server';

import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { memberships, submissions, results, rounds, questions, studentAnswers, remarkRequests } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

async function getEducatorSubmission(submissionId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const [row] = await db.select({ submission: submissions, result: results, round: rounds, membership: memberships })
    .from(submissions)
    .innerJoin(results, eq(results.submissionId, submissions.id))
    .innerJoin(rounds, eq(rounds.id, submissions.roundId))
    .innerJoin(memberships, and(eq(memberships.userId, user.id), eq(memberships.portalId, rounds.portalId), eq(memberships.role, 'educator')))
    .where(eq(submissions.id, submissionId)).limit(1);
  if (!row) throw new Error('Submission not found or access denied');
  return row;
}

export async function saveMarks(formData: FormData) {
  const submissionId = String(formData.get('submissionId') || '');
  const row = await getEducatorSubmission(submissionId);
  const stored = (row.submission.answersJson || {}) as Record<string, any>;
  const sittingId = String(stored.__sittingId || '');
  if (!sittingId) throw new Error('This submission is missing its sitting reference.');

  const qs = await db.select().from(questions).where(eq(questions.roundId, row.round.id));
  const answers = await db.select().from(studentAnswers).where(eq(studentAnswers.sittingId, sittingId));
  let total = 0;

  for (const q of qs) {
    const answer = answers.find(a => a.questionId === q.id);
    if (['single_choice', 'multiple_choice', 'true_false'].includes(q.questionType)) {
      if (!answer) continue;
      let parsed: any = answer.answerValue;
      try { parsed = JSON.parse(answer.answerValue); } catch {}
      let correct = false;
      if (q.questionType === 'multiple_choice') {
        const submitted = Array.isArray(parsed) ? parsed.map(String).sort() : [String(parsed)];
        const expected = Array.isArray(q.correctAnswer) ? q.correctAnswer.map(String).sort() : [String(q.correctAnswer)];
        correct = submitted.length === expected.length && submitted.every((v, i) => v === expected[i]);
      } else {
        correct = String(parsed) === String(q.correctAnswer);
      }
      total += correct ? q.marks : 0;
      continue;
    }

    const rawScore = Number(formData.get(`score_${q.id}`));
    if (!Number.isFinite(rawScore) || rawScore < 0 || rawScore > q.marks) {
      throw new Error(`Score for question ${qs.indexOf(q) + 1} must be between 0 and ${q.marks}.`);
    }
    const feedback = String(formData.get(`feedback_${q.id}`) || '').trim() || null;
    if (answer) {
      await db.update(studentAnswers).set({ manualScore: String(rawScore), educatorFeedback: feedback }).where(eq(studentAnswers.id, answer.id));
    } else {
      // No answer: record zero so the marker has explicitly reviewed it.
      await db.insert(studentAnswers).values({ sittingId, questionId: q.id, answerValue: '', manualScore: String(rawScore), educatorFeedback: feedback });
    }
    total += rawScore;
  }

  await db.update(results).set({ score: String(total), status: 'moderated', gradedByMembershipId: row.membership.id }).where(eq(results.id, row.result.id));

  const [request] = await db.select().from(remarkRequests).where(eq(remarkRequests.resultId, row.result.id)).limit(1);
  if (request?.status === 'pending') {
    await db.update(remarkRequests).set({ status: 'reviewed', reviewedAt: new Date(), reviewedByMembershipId: row.membership.id }).where(eq(remarkRequests.id, request.id));
  }

  revalidatePath('/educator/dashboard/grading');
  revalidatePath(`/educator/dashboard/grading/${submissionId}`);
  revalidatePath(`/results/${row.round.portalId}`);
}
