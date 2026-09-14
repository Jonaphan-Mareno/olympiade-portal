import type { QuestionData } from '@/components/student/ExamInterface';

export type MarkableQuestion = {
  id: string;
  questionType: QuestionData['questionType'];
  correctAnswer: any;
  marks: number;
};

function sameSet(a: string[], b: string[]) {
  return a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
}

/** Auto-mark questions for which the answer is unambiguous. */
export function autoMarkAnswer(question: MarkableQuestion, answerValue: string | undefined) {
  if (!['single_choice', 'multiple_choice', 'true_false'].includes(question.questionType)) {
    return null;
  }

  if (!answerValue) return 0;
  let answer: any = answerValue;
  try { answer = JSON.parse(answerValue); } catch { /* plain string */ }

  if (question.questionType === 'multiple_choice') {
    const submitted = Array.isArray(answer) ? answer.map(String) : [String(answer)];
    const correct = Array.isArray(question.correctAnswer)
      ? question.correctAnswer.map(String)
      : [String(question.correctAnswer)];
    return sameSet(submitted, correct) ? question.marks : 0;
  }

  return String(answer) === String(question.correctAnswer) ? question.marks : 0;
}

export function isAutoMarkable(questionType: string) {
  return ['single_choice', 'multiple_choice', 'true_false'].includes(questionType);
}
