import { describe, it, expect } from 'vitest';
import { generateMemoPdf, type PdfQuestion } from '@/lib/pdf/online-test-pdf';
import { correctChoices, optionText } from '@/domain/memo/memo';

const OPTIONS = ['Paris', 'Rome, Italy', 'Madrid'];

describe('memo answer reading', () => {
  it('reads every stored shape of the correct answer', () => {
    expect(correctChoices('Paris', OPTIONS)).toEqual(['Paris']);
    expect(correctChoices(['Paris', 'Madrid'], OPTIONS)).toEqual(['Paris', 'Madrid']);
    expect(correctChoices('["Paris","Madrid"]', OPTIONS)).toEqual(['Paris', 'Madrid']);
    expect(correctChoices('Paris,Madrid', OPTIONS)).toEqual(['Paris', 'Madrid']);
    expect(correctChoices({ text: 'Madrid' }, OPTIONS)).toEqual(['Madrid']);
  });

  it('does not split an option that contains a comma', () => {
    expect(correctChoices('Rome, Italy', OPTIONS)).toEqual(['Rome, Italy']);
  });

  it('matches options ignoring case and spacing, and handles empty answers', () => {
    expect(correctChoices(' paris ', OPTIONS)).toEqual(['Paris']);
    expect(correctChoices(null, OPTIONS)).toEqual([]);
    expect(correctChoices('', OPTIONS)).toEqual([]);
  });

  it('reads { text } options', () => {
    expect(optionText({ text: 'Paris' })).toBe('Paris');
    expect(optionText('Paris')).toBe('Paris');
  });
});

describe('generateMemoPdf', () => {
  it('builds a memo for every question type without throwing', async () => {
    const questions: PdfQuestion[] = [
      { id: 'q1', type: 'single_choice', prompt: 'Capital of France?', marks: 1, options: OPTIONS, correctAnswer: 'Paris' },
      { id: 'q2', type: 'multiple_choice', prompt: 'Pick two', marks: 2, options: OPTIONS, correctAnswer: '["Paris","Madrid"]' },
      { id: 'q3', type: 'true_false', prompt: 'Sky is blue', marks: 1, options: [], correctAnswer: 'true' },
      { id: 'q4', type: 'matching', prompt: 'Match', marks: 2, options: [{ premise: 'A', response: 'B' }], correctAnswer: null },
      { id: 'q5', type: 'free_text', prompt: 'Explain', marks: 3, options: null, correctAnswer: 'Any valid reason' },
    ];
    const bytes = await generateMemoPdf(questions, { roundName: 'Round 1' });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
  });
});
