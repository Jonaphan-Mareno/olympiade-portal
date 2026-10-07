import { describe, it, expect } from 'vitest';
import {
  checkOnlinePublishReadiness,
  checkPhysicalPublishReadiness,
} from '@/domain/question-bank/publish-readiness';
import {
  canReachExactly,
  drawVariant,
  mulberry32,
  type PoolQuestion,
} from '@/domain/question-bank/variant-generator';

const q = (
  id: string,
  marks: number | null,
  difficulty: number | null
): PoolQuestion => ({ id, marks, difficulty });

// A well-formed, reachable online pool: six 5-mark questions across the bands.
const validPool: PoolQuestion[] = [
  q('q1', 5, 1),
  q('q2', 5, 2),
  q('q3', 5, 3),
  q('q4', 5, 4),
  q('q5', 5, 5),
  q('q6', 5, 1),
];

describe('checkOnlinePublishReadiness', () => {
  it('passes a valid, reachable pool', () => {
    const r = checkOnlinePublishReadiness(validPool, 15);
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it('flags an empty pool', () => {
    const r = checkOnlinePublishReadiness([], 10);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.field === 'pool')).toBe(true);
  });

  it('flags missing marks', () => {
    const r = checkOnlinePublishReadiness([q('q1', null, 1)], 5);
    expect(r.ok).toBe(false);
    const issue = r.issues.find((i) => i.field === 'marks');
    expect(issue).toBeTruthy();
    expect(issue!.questionId).toBe('q1');
  });

  it('flags fractional (non-integer) marks', () => {
    const r = checkOnlinePublishReadiness([q('q1', 2.5, 1)], 5);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.field === 'marks' && i.questionId === 'q1')).toBe(true);
  });

  it('flags missing difficulty', () => {
    const r = checkOnlinePublishReadiness([q('q1', 5, null)], 5);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.field === 'difficulty' && i.questionId === 'q1')).toBe(true);
  });

  it('flags an invalid target total', () => {
    expect(checkOnlinePublishReadiness(validPool, 0).ok).toBe(false);
    expect(checkOnlinePublishReadiness(validPool, 12.5).ok).toBe(false);
    const issue = checkOnlinePublishReadiness(validPool, 0).issues.find(
      (i) => i.field === 'targetTotalMarks'
    );
    expect(issue).toBeTruthy();
  });

  it('flags an unreachable target and names the nearest achievable totals', () => {
    // Marks of 5 can total 10 or 15 but never 12.
    const r = checkOnlinePublishReadiness(validPool, 12);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.field === 'targetTotalMarks')).toBe(true);
    const summaryText = r.summary.join(' ');
    expect(summaryText).toMatch(/nearest achievable totals/i);
    expect(summaryText).toContain('10');
    expect(summaryText).toContain('15');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ryan #2 — the guard must be SEED-INDEPENDENT and agree with real draws
// ─────────────────────────────────────────────────────────────────────────────
describe('checkOnlinePublishReadiness: seed-independent reachability (Ryan #2)', () => {
  // 7+9+3 = 19 exactly. A single fixed-seed drawVariant probe used to be able to
  // go GREEN (or RED) depending on luck; ~190/400 real seeds stranded on 18.
  const trickyPool: PoolQuestion[] = [
    q('w', 7, 5),
    q('x', 6, 5),
    q('y', 9, 4),
    q('z', 3, 2),
  ];

  it('passes a target that is truly subset-sum reachable', () => {
    const r = checkOnlinePublishReadiness(trickyPool, 19);
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it('matches canReachExactly across many pools/targets (no seed dependence)', () => {
    for (let trial = 0; trial < 60; trial++) {
      const rng = mulberry32(2000 + trial);
      const n = 4 + Math.floor(rng() * 6);
      const p: PoolQuestion[] = Array.from({ length: n }, (_, i) => ({
        id: `p${trial}-${i}`,
        marks: 1 + Math.floor(rng() * 9),
        difficulty: (1 + Math.floor(rng() * 5)) as 1 | 2 | 3 | 4 | 5,
      }));
      const maxSum = p.reduce((s, x) => s + (x.marks ?? 0), 0);
      const target = 1 + Math.floor(rng() * maxSum);
      const reachable = canReachExactly(
        p.map((x) => x.marks),
        target
      );
      const result = checkOnlinePublishReadiness(p, target);
      const reachIssue = result.issues.some((i) => i.field === 'targetTotalMarks');
      // Guard is green (no target issue) EXACTLY when the target is reachable.
      expect(reachIssue, `trial ${trial} target ${target}`).toBe(!reachable);
    }
  });

  it('a GREEN guard means EVERY real seed reaches the target exactly', () => {
    // The whole point of the fairness mitigation: if the guard passes, no
    // student can be dealt a variant below the target.
    expect(checkOnlinePublishReadiness(trickyPool, 19).ok).toBe(true);
    for (let seed = 1; seed <= 400; seed++) {
      const v = drawVariant(trickyPool, 19, mulberry32(seed));
      expect(v.shortfall, `seed ${seed}`).toBe(0);
      expect(v.totalMarks, `seed ${seed}`).toBe(19);
    }
  });

  it('flags an unreachable target that a lucky seed might otherwise hide', () => {
    // Marks are all even → no odd total is reachable, whatever the seed.
    const evenPool: PoolQuestion[] = [q('a', 4, 1), q('b', 6, 2), q('c', 2, 3)];
    const r = checkOnlinePublishReadiness(evenPool, 9);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.field === 'targetTotalMarks')).toBe(true);
    expect(canReachExactly([4, 6, 2], 9)).toBe(false);
  });
});


describe('checkPhysicalPublishReadiness', () => {
  const pool: PoolQuestion[] = [
    q('q1', 5, null),
    q('q2', 7, null),
    q('q3', null, null), // unselected draft
  ];

  it('passes a selection whose questions all carry marks', () => {
    const r = checkPhysicalPublishReadiness(pool, ['q1', 'q2']);
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it('flags an empty selection', () => {
    expect(checkPhysicalPublishReadiness(pool, []).ok).toBe(false);
    expect(checkPhysicalPublishReadiness(pool, null).ok).toBe(false);
    const r = checkPhysicalPublishReadiness(pool, []);
    expect(r.issues.some((i) => i.field === 'selection')).toBe(true);
  });

  it('flags a selected id that is not in the pool', () => {
    const r = checkPhysicalPublishReadiness(pool, ['q1', 'ghost']);
    expect(r.ok).toBe(false);
    const issue = r.issues.find((i) => i.field === 'selection' && i.questionId === 'ghost');
    expect(issue).toBeTruthy();
  });

  it('flags a selected question missing its marks', () => {
    const r = checkPhysicalPublishReadiness(pool, ['q1', 'q3']);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.field === 'marks' && i.questionId === 'q3')).toBe(true);
  });

  it('does NOT flag unselected questions missing marks or difficulty', () => {
    // q3 (null marks) is left out of the paper; difficulty is unused for physical.
    const r = checkPhysicalPublishReadiness(pool, ['q1', 'q2']);
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });
});
