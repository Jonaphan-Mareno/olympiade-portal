import { db } from '@/lib/db';
import { questionPapers } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { loadPaperQuestions } from '../question-bank/load-variant';
import { buildMemoEntries, type MemoEntry } from './memo';

/**
 * A round's paper memo: the entries built from the organiser's ordered paper
 * selection (the same questions and order as the printed memo), and whether
 * the organiser also uploaded a memo PDF. Callers authorise first.
 */
export async function getRoundMemo(
  roundId: string
): Promise<{ entries: MemoEntry[]; hasUploadedMemo: boolean }> {
  const [paper] = await db
    .select({
      answerKeyJson: questionPapers.answerKeyJson,
      selectedQuestionIds: questionPapers.selectedQuestionIds,
    })
    .from(questionPapers)
    .where(eq(questionPapers.roundId, roundId));

  const rows = await loadPaperQuestions(
    { selectedQuestionIds: (paper?.selectedQuestionIds as string[] | null) ?? null },
    roundId
  );
  const entries = buildMemoEntries(
    rows.map((q) => ({
      id: q.id,
      type: q.questionType,
      prompt: q.prompt,
      marks: q.marks,
      options: q.options,
      correctAnswer: q.correctAnswer,
    }))
  );
  const hasUploadedMemo = Boolean(
    (paper?.answerKeyJson as { memoUrl?: string } | null)?.memoUrl
  );
  return { entries, hasUploadedMemo };
}
