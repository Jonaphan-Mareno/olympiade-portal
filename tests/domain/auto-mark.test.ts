import { describe, it, expect } from 'vitest';
import {
  aggregateMatchingAnswer,
  calculateEarnedMarks,
  getMatchingSelections,
  isUuid,
  matchingPairKey,
  matchingPairsOf,
  reassembleAnswers,
  resolveAnswer,
  splitMatchingKey,
} from '@/domain/marking/auto-mark';

// Question shapes mirror real rows from the questions table.

/** A matching question's id: a real uuid, because `question_id` is a uuid column. */
const Q_MATCH = '3f2b8c1e-6d4a-4f9b-9c2e-8a1d5e7f0b34';

const MATCH_PAIRS = [
  { premise: 'France', response: 'Paris' },
  { premise: 'Italy', response: 'Rome' },
  { premise: 'Spain', response: 'Madrid' },
];

const MATCHING_QUESTION = {
  id: Q_MATCH,
  questionType: 'matching',
  marks: 6,
  correctAnswer: null,
  options: MATCH_PAIRS,
};

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

  it('gives proportional credit on matching questions', () => {
    const matching = MATCHING_QUESTION;
    const all = JSON.stringify({
      [`${Q_MATCH}_0`]: 'Paris',
      [`${Q_MATCH}_1`]: 'Rome',
      [`${Q_MATCH}_2`]: 'Madrid',
    });

    expect(calculateEarnedMarks(matching, all)).toBe(6);
    // Two of three pairs -> two thirds of the marks, never all-or-nothing.
    expect(
      calculateEarnedMarks(
        matching,
        JSON.stringify({
          [`${Q_MATCH}_0`]: 'Paris',
          [`${Q_MATCH}_1`]: 'Rome',
          [`${Q_MATCH}_2`]: 'Berlin',
        })
      )
    ).toBe(4);
    expect(
      calculateEarnedMarks(matching, JSON.stringify({ [`${Q_MATCH}_0`]: 'Paris' }))
    ).toBe(2);
    expect(calculateEarnedMarks(matching, undefined)).toBe(0);
    expect(calculateEarnedMarks(matching, '')).toBe(0);
    expect(calculateEarnedMarks(matching, '{}')).toBe(0);
  });

  it('marks matching answers stored under bare pair-index keys', () => {
    // The practice interface builds `{"0":"Paris"}` rather than composite keys.
    const matching = {
      id: Q_MATCH,
      questionType: 'matching',
      marks: 3,
      correctAnswer: null,
      options: MATCH_PAIRS,
    };
    expect(
      calculateEarnedMarks(matching, JSON.stringify({ 0: 'Paris', 1: 'Rome', 2: 'Madrid' }))
    ).toBe(3);
  });

  it('compares matching responses case- and whitespace-insensitively', () => {
    const matching = {
      id: Q_MATCH,
      questionType: 'matching',
      marks: 3,
      correctAnswer: null,
      options: MATCH_PAIRS,
    };
    expect(
      calculateEarnedMarks(
        matching,
        JSON.stringify({
          [`${Q_MATCH}_0`]: '  paris ',
          [`${Q_MATCH}_1`]: 'ROME',
          [`${Q_MATCH}_2`]: 'Madrid',
        })
      )
    ).toBe(3);
  });

  it('reads matching pairs from jsonb text as well as an array', () => {
    const fromText = {
      id: Q_MATCH,
      questionType: 'matching',
      marks: 2,
      correctAnswer: null,
      options: JSON.stringify(MATCH_PAIRS.slice(0, 2)),
    };
    expect(
      calculateEarnedMarks(
        fromText,
        JSON.stringify({ [`${Q_MATCH}_0`]: 'Paris', [`${Q_MATCH}_1`]: 'Rome' })
      )
    ).toBe(2);
    // No pairs at all is 0 rather than a division by zero.
    expect(
      calculateEarnedMarks(
        { id: 'q-empty', questionType: 'matching', marks: 2, options: null },
        JSON.stringify({ 'q-empty_0': 'Paris' })
      )
    ).toBe(0);
  });
});

describe('matching answer key format', () => {
  it('accepts uuids and rejects the composite transport key', () => {
    expect(isUuid(Q_MATCH)).toBe(true);
    expect(isUuid(` ${Q_MATCH} `)).toBe(true);
    expect(isUuid(`${Q_MATCH}_0`)).toBe(false);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(42)).toBe(false);
  });

  it('builds and splits composite pair keys', () => {
    expect(matchingPairKey(Q_MATCH, 2)).toBe(`${Q_MATCH}_2`);
    expect(splitMatchingKey(`${Q_MATCH}_2`)).toEqual({ questionId: Q_MATCH, index: 2 });
    // A bare uuid has no underscore, so it is not a pair key.
    expect(splitMatchingKey(Q_MATCH)).toBeNull();
    expect(splitMatchingKey('q-1_x')).toBeNull();
  });

  it('parses pair selections without ever throwing', () => {
    expect(getMatchingSelections(JSON.stringify({ [`${Q_MATCH}_1`]: 'Rome' }))).toEqual({
      1: 'Rome',
    });
    expect(getMatchingSelections({ [`${Q_MATCH}_0`]: 'Paris' })).toEqual({ 0: 'Paris' });
    expect(getMatchingSelections(JSON.stringify({ 0: 'Paris', 2: null }))).toEqual({
      0: 'Paris',
      2: '',
    });
    expect(getMatchingSelections('not json')).toEqual({});
    expect(getMatchingSelections(JSON.stringify([1, 2]))).toEqual({});
    expect(getMatchingSelections(undefined)).toEqual({});
  });

  it('reads pairs from either an array or JSON text', () => {
    expect(matchingPairsOf({ options: MATCH_PAIRS })).toEqual(MATCH_PAIRS);
    expect(matchingPairsOf({ options: JSON.stringify(MATCH_PAIRS) })).toEqual(MATCH_PAIRS);
    expect(matchingPairsOf({ options: '{}' })).toEqual([]);
    expect(matchingPairsOf({})).toEqual([]);
  });

  it('aggregates one pair at a time without clobbering the others', () => {
    const first = aggregateMatchingAnswer(Q_MATCH, null, 0, 'Paris');
    expect(JSON.parse(first)).toEqual({ [`${Q_MATCH}_0`]: 'Paris' });

    const second = aggregateMatchingAnswer(Q_MATCH, first, 1, 'Rome');
    expect(JSON.parse(second)).toEqual({
      [`${Q_MATCH}_0`]: 'Paris',
      [`${Q_MATCH}_1`]: 'Rome',
    });

    // Re-answering pair 0 replaces only that pair.
    const changed = aggregateMatchingAnswer(Q_MATCH, second, 0, 'Lyon');
    expect(JSON.parse(changed)).toEqual({
      [`${Q_MATCH}_0`]: 'Lyon',
      [`${Q_MATCH}_1`]: 'Rome',
    });

    // A non-JSON leftover (e.g. an empty string) is replaced, not merged.
    expect(JSON.parse(aggregateMatchingAnswer(Q_MATCH, '', 0, 'Paris'))).toEqual({
      [`${Q_MATCH}_0`]: 'Paris',
    });
    // An undefined selection clears the pair but keeps the payload valid JSON.
    expect(JSON.parse(aggregateMatchingAnswer(Q_MATCH, second, 1))).toEqual({
      [`${Q_MATCH}_0`]: 'Paris',
      [`${Q_MATCH}_1`]: '',
    });
  });
});

describe('resolveAnswer / reassembleAnswers', () => {
  it('returns a plain answer untouched', () => {
    expect(resolveAnswer({ 'q-1': 'B' }, 'q-1')).toBe('B');
    expect(resolveAnswer({ 'q-1': 'B' }, 'q-2')).toBeUndefined();
    expect(resolveAnswer(null, 'q-1')).toBeUndefined();
  });

  it('folds legacy per-pair keys back under the base question id', () => {
    const legacy = {
      'q-1': 'B',
      [`${Q_MATCH}_0`]: 'Paris',
      [`${Q_MATCH}_2`]: 'Madrid',
    };
    expect(JSON.parse(resolveAnswer(legacy, Q_MATCH)!)).toEqual({
      [`${Q_MATCH}_0`]: 'Paris',
      [`${Q_MATCH}_2`]: 'Madrid',
    });

    const reassembled = reassembleAnswers(legacy);
    expect(Object.keys(reassembled).sort()).toEqual([Q_MATCH, 'q-1'].sort());
    expect(reassembled['q-1']).toBe('B');
    expect(calculateEarnedMarks(MATCHING_QUESTION, reassembled[Q_MATCH])).toBe(4);
  });

  it('keeps the aggregated payload and merges per-pair keys over it', () => {
    const mixed = {
      [Q_MATCH]: JSON.stringify({ [`${Q_MATCH}_0`]: 'Lyon', [`${Q_MATCH}_1`]: 'Rome' }),
      [`${Q_MATCH}_0`]: 'Paris',
    };
    expect(JSON.parse(resolveAnswer(mixed, Q_MATCH)!)).toEqual({
      [`${Q_MATCH}_0`]: 'Paris',
      [`${Q_MATCH}_1`]: 'Rome',
    });
  });

  it('stringifies non-string answer values', () => {
    expect(reassembleAnswers({ 'q-1': ['a', 'b'] })['q-1']).toBe(JSON.stringify(['a', 'b']));
    expect(reassembleAnswers({ 'q-1': 4 })['q-1']).toBe('4');
    expect(reassembleAnswers({})).toEqual({});
    expect(reassembleAnswers(undefined)).toEqual({});
  });

  it('never leaves a composite key in the reassembled map', () => {
    // The marker and every display page read `answers[q.id]`, so a composite key
    // left behind is exactly the bug that made matching always score 0.
    const reassembled = reassembleAnswers({
      [`${Q_MATCH}_0`]: 'Paris',
      [`${Q_MATCH}_1`]: 'Rome',
    });
    expect(Object.keys(reassembled).some((k) => /_\d+$/.test(k))).toBe(false);
    expect(reassembled[Q_MATCH]).toBeDefined();
  });
});
