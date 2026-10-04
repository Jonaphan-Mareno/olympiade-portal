import { describe, it, expect } from 'vitest';
import { calculateEarnedMarks } from '@/domain/marking/auto-mark';

// Question shapes mirror real rows from the questions table.
describe('calculateEarnedMarks', () => {
  const single = {
    id: 'q1',
    questionType: 'single_choice',
    marks: 10,
    correctAnswer: '21',
    options: ['19', '21'],
  };

  it('awards full marks for a correct single-choice answer', () => {
    expect(calculateEarnedMarks(single, '21')).toBe(10);
  });

  it('awards nothing for a wrong or missing single-choice answer', () => {
    expect(calculateEarnedMarks(single, '19')).toBe(0);
    expect(calculateEarnedMarks(single, undefined)).toBe(0);
    expect(calculateEarnedMarks(single, '')).toBe(0);
  });

  it('marks true/false questions', () => {
    const tf = { id: 'q2', questionType: 'true_false', marks: 1, correctAnswer: 'False', options: ['True', 'False'] };
    expect(calculateEarnedMarks(tf, 'True')).toBe(0);
    expect(calculateEarnedMarks(tf, 'False')).toBe(1);
  });

  it('gives proportional credit on multiple-choice questions', () => {
    const mc = { id: 'q3', questionType: 'multiple_choice', marks: 4, correctAnswer: ['a', 'b'], options: ['a', 'b', 'c'] };
    expect(calculateEarnedMarks(mc, JSON.stringify(['a', 'b']))).toBe(4);
    expect(calculateEarnedMarks(mc, JSON.stringify(['a']))).toBe(2);
    expect(calculateEarnedMarks(mc, JSON.stringify(['c']))).toBe(0);
  });

  it('leaves free-text questions to educators', () => {
    const ft = { id: 'q4', questionType: 'free_text', marks: 5, correctAnswer: null, options: null };
    expect(calculateEarnedMarks(ft, 'anything')).toBe(0);
  });

  it('marks comma-joined multi-select answers saved by the exam screen', () => {
    // Real row: the Garfield question
    const garfield = {
      id: 'q5',
      questionType: 'multiple_choice',
      marks: 4,
      correctAnswer: ['He likes lasagna', 'his  humans name is John'],
      options: ['He is a feamle', 'He likes lasagna', 'his  humans name is John', 'He is a slim stud'],
    };
    expect(calculateEarnedMarks(garfield, 'his  humans name is John,He likes lasagna')).toBe(4);
    expect(calculateEarnedMarks(garfield, 'He is a feamle,He likes lasagna')).toBe(2);
  });

  it('recognises options that contain commas', () => {
    const q = {
      id: 'q6',
      questionType: 'multiple_choice',
      marks: 2,
      correctAnswer: ['Paris, France', 'Rome'],
      options: ['Paris, France', 'Rome', 'Berlin'],
    };
    expect(calculateEarnedMarks(q, 'Paris, France,Rome')).toBe(2);
  });
});
