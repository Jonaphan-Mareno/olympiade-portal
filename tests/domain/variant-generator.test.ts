import { describe, it, expect } from 'vitest';
import {
  drawVariant,
  mulberry32,
  canReachExactly,
  type PoolQuestion,
} from '@/domain/question-bank/variant-generator';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function pool(count: number, marks: number, startBand = 1): PoolQuestion[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `q${i + 1}`,
    marks,
    difficulty: (((startBand - 1 + i) % 5) + 1) as 1 | 2 | 3 | 4 | 5,
  }));
}

/** A pool spread evenly over all five difficulty bands. */
function stratifiedPool(perBand: number, marks: number): PoolQuestion[] {
  const out: PoolQuestion[] = [];
  for (let band = 1; band <= 5; band++) {
    for (let i = 0; i < perBand; i++) {
      out.push({
        id: `b${band}-q${i}`,
        marks,
        difficulty: band as 1 | 2 | 3 | 4 | 5,
      });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// mulberry32
// ─────────────────────────────────────────────────────────────────────────────
describe('mulberry32', () => {
  it('is deterministic for a given seed and stays in [0, 1)', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('produces different sequences for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const s1 = Array.from({ length: 5 }, () => a());
    const s2 = Array.from({ length: 5 }, () => b());
    expect(s1).not.toEqual(s2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// drawVariant
// ─────────────────────────────────────────────────────────────────────────────
describe('drawVariant', () => {
  it('hits an exact target with uniform marks (shortfall 0)', () => {
    const v = drawVariant(pool(20, 5), 50, mulberry32(7));
    expect(v.totalMarks).toBe(50);
    expect(v.shortfall).toBe(0);
    expect(v.questionIds).toHaveLength(10);
  });

  it('spreads the selection across difficulty bands (stratified)', () => {
    // 4 per band, marks 1, target 15 → 15 of 20 questions, evenly spread.
    const v = drawVariant(stratifiedPool(4, 1), 15, mulberry32(11));
    expect(v.shortfall).toBe(0);
    const counts = Object.values(v.byDifficulty);
    expect(counts.reduce((s, n) => s + n, 0)).toBe(15);
    const spread = Math.max(...counts) - Math.min(...counts);
    expect(spread).toBeLessThanOrEqual(1); // within tolerance
  });

  it('never exceeds the target total', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const p = stratifiedPool(6, 3);
      const target = 37; // not a multiple of 3 → must round down
      const v = drawVariant(p, target, mulberry32(seed));
      expect(v.totalMarks).toBeLessThanOrEqual(target);
      expect(v.shortfall).toBe(target - v.totalMarks);
    }
  });

  it('returns the largest reachable total ≤ target with shortfall > 0 when unreachable', () => {
    // Marks of 5 can never sum to 12; best is 10, shortfall 2. No throw.
    const v = drawVariant(pool(6, 5), 12, mulberry32(3));
    expect(v.totalMarks).toBe(10);
    expect(v.shortfall).toBe(2);
    expect(v.totalMarks).toBeLessThanOrEqual(12);
  });

  it('is deterministic for a fixed seed', () => {
    const p = stratifiedPool(5, 2);
    const a = drawVariant(p, 22, mulberry32(99));
    const b = drawVariant(p, 22, mulberry32(99));
    expect(a).toEqual(b);
  });

  it('differs across two seeds', () => {
    const p = stratifiedPool(6, 1);
    const a = drawVariant(p, 12, mulberry32(1));
    const b = drawVariant(p, 12, mulberry32(2));
    // Same size/target but a different deal or order.
    expect(a.questionIds).not.toEqual(b.questionIds);
  });

  it('terminates on the DP work-cap path (skips subset-sum, reports shortfall)', () => {
    // 3000 questions that individually exceed the target → greedy picks none,
    // gap × candidates = 2000 × 3000 > 5,000,000 so the DP is skipped.
    const big: PoolQuestion[] = Array.from({ length: 3000 }, (_, i) => ({
      id: `big${i}`,
      marks: 5000,
      difficulty: ((i % 5) + 1) as 1 | 2 | 3 | 4 | 5,
    }));
    const v = drawVariant(big, 2000, mulberry32(5));
    expect(v.totalMarks).toBe(0);
    expect(v.shortfall).toBe(2000);
    expect(v.questionIds).toHaveLength(0);
  });

  it('closes a residual gap with the subset-sum DP', () => {
    // Greedy (marks 6) reaches 12 of 15; the DP adds a 3-mark question to hit 15.
    const p: PoolQuestion[] = [
      { id: 'a', marks: 6, difficulty: 1 },
      { id: 'b', marks: 6, difficulty: 2 },
      { id: 'c', marks: 6, difficulty: 3 },
      { id: 'd', marks: 3, difficulty: 4 },
    ];
    const v = drawVariant(p, 15, mulberry32(21));
    expect(v.totalMarks).toBe(15);
    expect(v.shortfall).toBe(0);
  });

  it('returns no duplicate ids and only ids from the pool', () => {
    const p = stratifiedPool(6, 2);
    const ids = new Set(p.map((q) => q.id));
    for (let seed = 1; seed <= 25; seed++) {
      const v = drawVariant(p, 30, mulberry32(seed));
      expect(new Set(v.questionIds).size).toBe(v.questionIds.length);
      for (const id of v.questionIds) expect(ids.has(id)).toBe(true);
    }
  });

  it('never throws on degenerate input', () => {
    expect(drawVariant([], 10, mulberry32(1))).toEqual({
      questionIds: [],
      totalMarks: 0,
      shortfall: 10,
      byDifficulty: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    });
    // Null marks/difficulty are normalized (marks → 1, difficulty → lowest
    // band); fractional marks round to the nearest integer. x=1, y=3 → target 4.
    const messy: PoolQuestion[] = [
      { id: 'x', marks: null, difficulty: null },
      { id: 'y', marks: 2.6, difficulty: 9 },
    ];
    const v = drawVariant(messy, 4, mulberry32(4));
    expect(v.totalMarks).toBe(4);
    expect(v.shortfall).toBe(0);
    expect(v.questionIds.sort()).toEqual(['x', 'y']);
  });

  it('treats a zero/negative target as an empty draw', () => {
    const v = drawVariant(pool(5, 5), 0, mulberry32(1));
    expect(v.questionIds).toHaveLength(0);
    expect(v.shortfall).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ryan #1 — an exact target must survive the balance-swap step
// ─────────────────────────────────────────────────────────────────────────────
describe('drawVariant: exact target preserved under balance swaps (Ryan #1)', () => {
  // A(10,d1) + B(1,d1) = 11 exactly; D(5,d5) is the tempting balance swap that
  // used to silently drop the total to 6. The exact subset must always win.
  const ryanPool: PoolQuestion[] = [
    { id: 'A', marks: 10, difficulty: 1 },
    { id: 'B', marks: 1, difficulty: 1 },
    { id: 'D', marks: 5, difficulty: 5 },
  ];

  it('hits 11 exactly for EVERY seed (never regresses to 6)', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const v = drawVariant(ryanPool, 11, mulberry32(seed));
      expect(v.totalMarks, `seed ${seed}`).toBe(11);
      expect(v.shortfall, `seed ${seed}`).toBe(0);
      expect(v.questionIds.sort()).toEqual(['A', 'B']);
    }
  });

  it('keeps an exact total when a total-preserving (equal-marks) swap exists', () => {
    // Two 4-mark questions in band 1, two 4-mark questions in band 5, target 8.
    // A band-rebalancing swap is possible at EQUAL marks, so total stays exact.
    const p: PoolQuestion[] = [
      { id: 'a1', marks: 4, difficulty: 1 },
      { id: 'a2', marks: 4, difficulty: 1 },
      { id: 'b1', marks: 4, difficulty: 5 },
      { id: 'b2', marks: 4, difficulty: 5 },
    ];
    for (let seed = 1; seed <= 50; seed++) {
      const v = drawVariant(p, 8, mulberry32(seed));
      expect(v.totalMarks, `seed ${seed}`).toBe(8);
      expect(v.shortfall, `seed ${seed}`).toBe(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ryan #2 — drawVariant guarantees exactness for every seed when reachable
// ─────────────────────────────────────────────────────────────────────────────
describe('drawVariant: seed-independent exactness guarantee (Ryan #2)', () => {
  // 7+9+3 = 19 exactly, but a greedy deal can strand on 6+9+3 = 18. The exact
  // subset-sum fallback must recover 19 for EVERY seed (previously ~190/400
  // seeds fell short, making a 95% qualifying threshold unreachable).
  const ryan2Pool: PoolQuestion[] = [
    { id: 'w', marks: 7, difficulty: 5 },
    { id: 'x', marks: 6, difficulty: 5 },
    { id: 'y', marks: 9, difficulty: 4 },
    { id: 'z', marks: 3, difficulty: 2 },
  ];

  it('reaches 19 exactly across 400 seeds (no seed falls short)', () => {
    let short = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const v = drawVariant(ryan2Pool, 19, mulberry32(seed));
      expect(v.totalMarks, `seed ${seed}`).toBeLessThanOrEqual(19);
      if (v.shortfall !== 0) short += 1;
    }
    expect(short).toBe(0);
  });

  it('agrees with canReachExactly on many random pools (reachable ⇒ shortfall 0)', () => {
    // Build deterministic pseudo-random pools and cross-check the guard oracle
    // against the actual draw for every seed.
    for (let trial = 0; trial < 60; trial++) {
      const rng = mulberry32(1000 + trial);
      const n = 4 + Math.floor(rng() * 6); // 4..9 questions
      const p: PoolQuestion[] = Array.from({ length: n }, (_, i) => ({
        id: `t${trial}-q${i}`,
        marks: 1 + Math.floor(rng() * 9), // 1..9
        difficulty: (1 + Math.floor(rng() * 5)) as 1 | 2 | 3 | 4 | 5,
      }));
      const maxSum = p.reduce((s, q) => s + (q.marks ?? 0), 0);
      const target = 1 + Math.floor(rng() * maxSum);
      const reachable = canReachExactly(
        p.map((q) => q.marks),
        target
      );
      for (let seed = 1; seed <= 15; seed++) {
        const v = drawVariant(p, target, mulberry32(seed * 7 + trial));
        expect(v.totalMarks).toBeLessThanOrEqual(target); // never exceeds
        if (reachable) {
          expect(v.shortfall, `trial ${trial} target ${target} seed ${seed}`).toBe(0);
        }
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// canReachExactly — the seed-independent reachability oracle
// ─────────────────────────────────────────────────────────────────────────────
describe('canReachExactly', () => {
  it('detects a reachable target', () => {
    expect(canReachExactly([7, 6, 9, 3], 19)).toBe(true); // 7+9+3
    expect(canReachExactly([5, 5, 5], 10)).toBe(true);
    expect(canReachExactly([1, 2, 3], 6)).toBe(true); // 1+2+3
  });

  it('detects an unreachable target', () => {
    expect(canReachExactly([5, 5, 5], 12)).toBe(false); // multiples of 5 only
    expect(canReachExactly([7, 6, 9, 3], 1)).toBe(false);
    expect(canReachExactly([4, 8], 7)).toBe(false);
  });

  it('treats target 0 as trivially reachable and normalizes marks', () => {
    expect(canReachExactly([5, 5], 0)).toBe(true);
    // null/sub-1/fractional marks normalize the same way drawVariant does.
    expect(canReachExactly([null, 2.6], 4)).toBe(true); // 1 + round(2.6)=3 → 4
    expect(canReachExactly([null, 2.6], 5)).toBe(false);
  });

  it('is order-independent (unlike a single seeded draw)', () => {
    const marks = [7, 6, 9, 3];
    const perms = [
      [7, 6, 9, 3],
      [3, 9, 6, 7],
      [9, 3, 7, 6],
      [6, 7, 3, 9],
    ];
    for (const p of perms) expect(canReachExactly(p, 19)).toBe(true);
  });

  it('terminates on the work-cap path and stays correct for a determinate case', () => {
    // Every mark exceeds the target → provably unreachable, and the sparse
    // fallback must return quickly rather than allocating a huge DP table.
    const huge = Array.from({ length: 4000 }, () => 5000);
    expect(canReachExactly(huge, 2000)).toBe(false);
    // A large-but-reachable dense case still resolves exactly.
    const many = Array.from({ length: 2000 }, (_, i) => (i % 3) + 1); // 1s,2s,3s
    expect(canReachExactly(many, 3000)).toBe(true);
  });
});

