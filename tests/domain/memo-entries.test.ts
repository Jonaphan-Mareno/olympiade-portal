import { describe, it, expect } from 'vitest';
import { buildMemoEntries, seededOrder, letter } from '@/domain/memo/memo';

describe('buildMemoEntries', () => {
  it('marks the correct options with paper letters and an answer line', () => {
    const [single, multi] = buildMemoEntries([
      { id: 'q1', type: 'single_choice', prompt: 'Capital?', marks: 2, options: ['Rome', 'Paris'], correctAnswer: 'Paris' },
      { id: 'q2', type: 'multiple_choice', prompt: 'Pick', marks: null, options: ['a', 'b', 'c'], correctAnswer: '["a","c"]' },
    ]);
    expect(single).toMatchObject({
      number: 1,
      prompt: 'Capital?',
      marks: 2,
      answer: 'B',
      options: [
        { letter: 'A', text: 'Rome', correct: false },
        { letter: 'B', text: 'Paris', correct: true },
      ],
    });
    expect(multi.answer).toBe('A, C');
    expect(multi.marks).toBe(1);
  });

  it('gives True/False and free-text answers', () => {
    const [tf, text, none] = buildMemoEntries([
      { id: 'q1', type: 'true_false', prompt: '', marks: 1, options: [], correctAnswer: 'false' },
      { id: 'q2', type: 'free_text', prompt: '', marks: 3, options: null, correctAnswer: { memo: 'Any two reasons' } },
      { id: 'q3', type: 'single_choice', prompt: '', marks: 1, options: ['x'], correctAnswer: null },
    ]);
    expect(tf.answer).toBe('False');
    expect(text.guideline).toBe('Any two reasons');
    expect(none.answer).toBeNull();
  });

  it('uses the same Column B letters as the printed paper for matching', () => {
    const pairs = [
      { premise: 'France', response: 'Paris' },
      { premise: 'Italy', response: 'Rome' },
      { premise: 'Spain', response: 'Madrid' },
    ];
    const [entry] = buildMemoEntries([
      { id: 'match-1', type: 'matching', prompt: '', marks: 3, options: pairs, correctAnswer: null },
    ]);
    const order = seededOrder(3, 'match-1');
    entry.pairs.forEach((p, i) => {
      expect(p.premise).toBe(pairs[i].premise);
      expect(p.letter).toBe(letter(order.indexOf(i)));
      expect(p.response).toBe(pairs[i].response);
    });
  });
});
