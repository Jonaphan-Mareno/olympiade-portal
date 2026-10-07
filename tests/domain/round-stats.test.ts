import { describe, it, expect } from 'vitest';
import { computeRoundStats } from '@/domain/rounds/round-stats';

// computeRoundStats is the pure aggregation behind the organiser console's
// round statistics: it deduplicates writers across submissions and online
// sittings, averages the marked scores and derives the pass rate from the
// round's qualifying threshold.

const baseInput = {
  qualifyingThreshold: null as string | null,
  totalMarks: 100,
  submissionRows: [] as {
    studentMembershipId: string | null;
    status: string | null;
  }[],
  sittingStudentIds: [] as (string | null)[],
  markedScores: [] as (string | number | null)[],
  advanced: 0,
};

describe('computeRoundStats', () => {
  it('returns zeroed stats for a round with no activity', () => {
    const stats = computeRoundStats(baseInput);

    expect(stats).toEqual({
      entrants: 0,
      wrote: 0,
      completed: 0,
      marked: 0,
      averageScore: null,
      averagePercentage: null,
      passRate: null,
      advanced: 0,
    });
  });

  it('deduplicates writers across submissions and sittings', () => {
    const stats = computeRoundStats({
      ...baseInput,
      submissionRows: [
        { studentMembershipId: 's1', status: 'draft' },
        { studentMembershipId: 's1', status: 'draft' },
        { studentMembershipId: 's2', status: 'submitted' },
      ],
      sittingStudentIds: ['s1', 's3', null],
    });

    expect(stats.wrote).toBe(3);
    expect(stats.completed).toBe(1);
  });

  it('counts completers only for submitted submissions, once per student', () => {
    const stats = computeRoundStats({
      ...baseInput,
      submissionRows: [
        { studentMembershipId: 's1', status: 'submitted' },
        { studentMembershipId: 's1', status: 'draft' }, // superseded draft
        { studentMembershipId: 's2', status: 'draft' },
      ],
    });

    expect(stats.wrote).toBe(2);
    expect(stats.completed).toBe(1);
  });

  it('averages marked scores, ignoring invalid entries', () => {
    const stats = computeRoundStats({
      ...baseInput,
      markedScores: ['50', 70, null, ''],
    });

    expect(stats.marked).toBe(2);
    expect(stats.averageScore).toBe(60);
    expect(stats.averagePercentage).toBe(60);
  });

  it('computes the pass rate against the qualifying threshold', () => {
    const stats = computeRoundStats({
      ...baseInput,
      qualifyingThreshold: '60',
      markedScores: [70, 50, 60], // 70 and 60 pass, 50 fails
    });

    expect(stats.passRate).toBe(66.7);
  });

  it('returns a null pass rate when the round has no threshold', () => {
    const stats = computeRoundStats({ ...baseInput, markedScores: [10, 90] });

    expect(stats.passRate).toBeNull();
  });

  it('returns null percentages when no total marks are known', () => {
    const stats = computeRoundStats({
      ...baseInput,
      totalMarks: 0,
      qualifyingThreshold: '50',
      markedScores: [10, 20],
    });

    expect(stats.averageScore).toBe(15);
    expect(stats.averagePercentage).toBeNull();
    expect(stats.passRate).toBeNull();
  });

  it('derives the average percentage from the unrounded mean', () => {
    // 30+45+50+20 of 50 marks: mean 36.25 -> 72.5%, not the 72.6% the
    // 1dp-rounded 36.3 would produce. 20/50 (40%) still meets a 40 threshold.
    const stats = computeRoundStats({
      ...baseInput,
      totalMarks: 50,
      qualifyingThreshold: '40',
      markedScores: [30, 45, 50, 20],
    });

    expect(stats.averageScore).toBe(36.3);
    expect(stats.averagePercentage).toBe(72.5);
    expect(stats.passRate).toBe(100);
  });

  it('rounds the average to one decimal place', () => {
    const halves = computeRoundStats({ ...baseInput, markedScores: [1, 2] });
    expect(halves.averageScore).toBe(1.5);

    const thirds = computeRoundStats({
      ...baseInput,
      markedScores: [1, 1, 2],
    });
    expect(thirds.averageScore).toBe(1.3);
  });

  it('passes the advancement count through unchanged', () => {
    const stats = computeRoundStats({ ...baseInput, advanced: 7 });
    expect(stats.advanced).toBe(7);
  });
});
