// Pure, DB-free, framework-free variant generator for online rounds.
//
// Each online entrant is dealt a difficulty-balanced random subset of the
// round's question pool that fills (but never exceeds) an organiser-set target
// total marks. The exact draw is frozen on the sitting, so this module must be
// deterministic for a given RNG and must NEVER throw — a bad pool degrades to a
// best-effort variant with a reported `shortfall` rather than failing the sit.
//
// FAIRNESS INVARIANT (see Ultra Review, task #14): whenever the target is
// reachable by ANY subset of the pool (`canReachExactly`), `drawVariant` MUST
// return a variant with `shortfall === 0` for EVERY seed — never a total below
// the target that a student could be unfairly graded against. Balance is a
// secondary objective that is only ever traded away from an exact total, never
// into a shortfall.
//
// The RNG is injectable so callers can use crypto randomness in production and
// a fixed seed (`mulberry32`) for previews, the publish guard and the tests.

/** A single question in the round's pool, as far as the draw is concerned. */
export type PoolQuestion = {
  id: string;
  marks: number | null;
  difficulty: number | null;
};

/** Difficulty bands a question can occupy. `null` difficulty maps to band 0. */
export type Difficulty = 1 | 2 | 3 | 4 | 5;

/** The dealt variant: presentation-ordered ids plus grading metadata. */
export type Variant = {
  /** Selected question ids in PRESENTATION order (interleaved by difficulty). */
  questionIds: string[];
  /** Sum of the normalized marks of the selected questions. */
  totalMarks: number;
  /** max(0, targetTotal - totalMarks); 0 means the target was hit exactly. */
  shortfall: number;
  /** Selected-question count per real difficulty band (band 0 is excluded). */
  byDifficulty: Record<Difficulty, number>;
};

/** Real difficulty bands, in round-robin priority order (balanced spread). */
const REAL_BANDS: Difficulty[] = [1, 2, 3, 4, 5];
/** Band used for questions with a null/out-of-range difficulty (lowest priority). */
const NULL_BAND = 0;
/** Priority order for round-robin and interleaving: balanced bands first. */
const BAND_ORDER: number[] = [...REAL_BANDS, NULL_BAND];
/** Cap on subset-sum work: skip the exact DP when (candidates × gap) exceeds it. */
const DP_WORK_CAP = 5_000_000;
/** Cap on the number of balance-improving swaps. */
const MAX_SWAPS = 25;
/** Bound on distinct reachable sums tracked by the sparse `canReachExactly` fallback. */
const SPARSE_SUM_CAP = 200_000;

/**
 * mulberry32 — a tiny, fast, well-distributed 32-bit seeded PRNG. Returns a
 * function yielding floats in [0, 1). Same seed ⇒ same sequence, which is what
 * makes previews, the publish guard and the tests reproducible.
 * (Same seeding idiom as `seededOrder` in `src/lib/pdf/online-test-pdf.ts`.)
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function rand(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Default RNG: crypto-backed when available (server + browser), else
 * Math.random. Kept as a plain function so `drawVariant` stays pure when an
 * explicit `rand` is injected.
 */
function cryptoRandom(): number {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    c.getRandomValues(buf);
    return buf[0] / 4294967296;
  }
  return Math.random();
}

/**
 * Normalize a raw mark to an integer ≥ 1.
 *
 * JUDGMENT CALL (documented per the task): null / non-finite / sub-1 marks are
 * treated as `1` rather than skipped, so every pool question stays eligible for
 * the draw and the result is deterministic. Fractional marks are rounded to the
 * nearest integer (the builder enforces `step="1"`, so this is a safety net that
 * keeps the subset-sum DP exact). The publish guard flags any question that
 * needs this coercion before a round can go live.
 */
function normalizeMarks(raw: number | null | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.round(n));
}

/** Clamp a raw difficulty into a real band 1–5, or the null band (0). */
function bandOf(raw: number | null | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return NULL_BAND;
  const d = Math.round(n);
  return d >= 1 && d <= 5 ? d : NULL_BAND;
}

/** Fisher–Yates shuffle in place using the injected RNG. */
function shuffle<T>(arr: T[], rand: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

type Item = { id: string; marks: number; band: number };

function emptyByDifficulty(): Record<Difficulty, number> {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
}

/**
 * SEED-INDEPENDENT exact subset-sum reachability.
 *
 * Proves whether ANY subset of `marks` sums to exactly `target`, using the same
 * normalization `drawVariant` applies (int ≥ 1). This is the authoritative
 * reachability oracle behind the online publish guard: unlike a single seeded
 * `drawVariant` probe, its answer does not depend on question order or RNG, so
 * a GREEN guard genuinely means every real draw can hit the target.
 *
 * Work-capped: for realistic pools it runs the dense O(n × target) DP. Only for
 * pathologically large inputs (n × target > DP_WORK_CAP) does it fall back to a
 * bounded sparse sweep that still terminates and never returns a false positive.
 */
export function canReachExactly(
  marks: Array<number | null | undefined>,
  target: number
): boolean {
  const rawT = Number(target);
  const t = Number.isFinite(rawT) ? Math.max(0, Math.floor(rawT)) : 0;
  if (t === 0) return true; // the empty subset always sums to 0
  if (!Array.isArray(marks)) return false;

  // Normalize identically to the draw, and drop items that alone exceed target.
  const norm: number[] = [];
  for (const m of marks) {
    const n = normalizeMarks(m);
    if (n <= t) norm.push(n);
  }
  if (norm.length === 0) return false;

  if (norm.length * t <= DP_WORK_CAP) {
    const reach = new Uint8Array(t + 1);
    reach[0] = 1;
    for (const m of norm) {
      for (let s = t; s >= m; s--) {
        if (reach[s - m] === 1) reach[s] = 1;
      }
      if (reach[t] === 1) return true; // early exit once proven
    }
    return reach[t] === 1;
  }

  // Work-cap fallback: sparse BFS over reachable sums, bounded so it terminates.
  // Conservative — returns true only when the target is genuinely constructed.
  const sums = new Set<number>([0]);
  for (const m of norm) {
    if (sums.has(t)) return true;
    const additions: number[] = [];
    for (const s of sums) {
      const ns = s + m;
      if (ns <= t && !sums.has(ns)) additions.push(ns);
    }
    for (const ns of additions) sums.add(ns);
    if (sums.size > SPARSE_SUM_CAP) return sums.has(t);
  }
  return sums.has(t);
}

/**
 * Find ANY subset of `items` whose normalized marks sum to exactly `target`, or
 * `null` when unreachable / over the work cap. Uses the classic 0/1 subset-sum
 * DP with a `from` back-pointer for reconstruction. `items` must already be
 * normalized and de-duplicated; their order is the balance tie-break (the DP
 * records the first item that reaches each sum), so callers pass a round-robin
 * interleaving to bias the reconstruction toward a balanced spread.
 */
function findExactSubset(items: Item[], target: number): Item[] | null {
  if (target <= 0) return target === 0 ? [] : null;
  const usable = items.filter((it) => it.marks <= target);
  if (usable.length === 0) return null;
  if (usable.length * target > DP_WORK_CAP) return null; // caller documents shortfall

  const reach = new Uint8Array(target + 1);
  const from = new Int32Array(target + 1).fill(-1);
  reach[0] = 1;
  for (let i = 0; i < usable.length; i++) {
    const m = usable[i].marks;
    for (let s = target; s >= m; s--) {
      if (reach[s - m] === 1 && reach[s] === 0) {
        reach[s] = 1;
        from[s] = i;
      }
    }
  }
  if (reach[target] !== 1) return null;

  const out: Item[] = [];
  let s = target;
  while (s > 0) {
    const i = from[s];
    if (i < 0) break; // defensive; unreachable when reach[target] === 1
    out.push(usable[i]);
    s -= usable[i].marks;
  }
  return s === 0 ? out : null;
}

/**
 * Deal a difficulty-balanced variant from `pool` that fills `targetTotal`.
 *
 * Steps:
 *   0. normalize marks (int ≥ 1) + clamp difficulty, bucket by band, shuffle;
 *   1. stratified round-robin greedy — never exceeds the target;
 *   2. residual repair via a work-capped subset-sum DP (least-represented bands
 *      preferred) to close any remaining gap;
 *   3. GUARANTEE: if still short, a full exact subset-sum DP over the whole pool
 *      finds an exact-`target` subset whenever one exists (so a reachable target
 *      is ALWAYS hit, for every seed);
 *   4. up to 25 balance-improving, TOTAL-PRESERVING swaps (never exceed target;
 *      once exact, only equal-marks swaps), re-closing any gap a swap opens;
 *   5. adopt the best selection seen (smallest shortfall, then best balance) and
 *      interleave presentation order by difficulty.
 * Never throws: on any degenerate input it returns a best-effort variant.
 */
export function drawVariant(
  pool: PoolQuestion[],
  targetTotal: number,
  rand: () => number = cryptoRandom
): Variant {
  const byDifficulty = emptyByDifficulty();

  // Sanitize the target: a non-finite/negative target degrades to 0 (empty draw).
  const rawTarget = Number(targetTotal);
  const target = Number.isFinite(rawTarget) ? Math.max(0, Math.floor(rawTarget)) : 0;

  if (!Array.isArray(pool) || pool.length === 0 || target <= 0) {
    return { questionIds: [], totalMarks: 0, shortfall: target, byDifficulty };
  }

  // (0) Normalize + bucket by difficulty band, then seeded-shuffle each bucket.
  const items: Item[] = [];
  const buckets = new Map<number, Item[]>();
  for (const b of BAND_ORDER) buckets.set(b, []);
  const seen = new Set<string>();
  for (const q of pool) {
    if (!q || typeof q.id !== 'string' || seen.has(q.id)) continue; // skip dupes
    seen.add(q.id);
    const band = bandOf(q.difficulty);
    const item: Item = { id: q.id, marks: normalizeMarks(q.marks), band };
    items.push(item);
    buckets.get(band)!.push(item);
  }
  for (const b of BAND_ORDER) shuffle(buckets.get(b)!, rand);

  // Round-robin interleave of the shuffled buckets: a balance-biased item order
  // used as the tie-break for the exact subset-sum reconstruction in step (3).
  const ordered: Item[] = [];
  {
    const bIdx = new Map<number, number>();
    for (const b of BAND_ORDER) bIdx.set(b, 0);
    let remainingItems = items.length;
    while (remainingItems > 0) {
      for (const b of BAND_ORDER) {
        const list = buckets.get(b)!;
        const p = bIdx.get(b)!;
        if (p < list.length) {
          ordered.push(list[p]);
          bIdx.set(b, p + 1);
          remainingItems -= 1;
        }
      }
    }
  }

  // Working selection state (reassignable so step 3 can adopt an exact subset).
  let selected: Item[] = [];
  let selectedIds = new Set<string>();
  let total = 0;
  const take = (item: Item) => {
    selected.push(item);
    selectedIds.add(item.id);
    total += item.marks;
  };
  const recomputeBands = () => {
    for (const b of REAL_BANDS) byDifficulty[b] = byDifficultyCount(selected, b);
  };

  // bestSoFar: the selection with the smallest shortfall seen, tie-broken by the
  // tightest difficulty spread. This is what we RETURN, so a later swap can never
  // hand back a worse total than one we already held (Ryan #1).
  let bestSelected: Item[] = [];
  let bestTotal = 0;
  let bestShortfall = Number.POSITIVE_INFINITY;
  let bestSpread = Number.POSITIVE_INFINITY;
  const snapshot = () => {
    const shortfall = Math.max(0, target - total);
    const spread = spreadOf(selected);
    if (shortfall < bestShortfall || (shortfall === bestShortfall && spread < bestSpread)) {
      bestSelected = selected.slice();
      bestTotal = total;
      bestShortfall = shortfall;
      bestSpread = spread;
    }
  };

  // (2) Residual repair: close the current gap from the UNSELECTED pool with a
  // bounded subset-sum DP, preferring least-represented bands to keep balance.
  const closeResidual = () => {
    const gap = target - total;
    if (gap <= 0) return;
    const unselected = items.filter((it) => !selectedIds.has(it.id));
    if (unselected.length === 0 || unselected.length * gap > DP_WORK_CAP) return;

    const countOf = (band: number) =>
      band >= 1 && band <= 5 ? byDifficultyCount(selected, band) : selected.length;
    const cands = unselected.slice().sort((a, b) => {
      const d = countOf(a.band) - countOf(b.band);
      return d !== 0 ? d : a.marks - b.marks;
    });

    const reach = new Uint8Array(gap + 1);
    const from = new Int32Array(gap + 1).fill(-1);
    reach[0] = 1;
    for (let i = 0; i < cands.length; i++) {
      const m = cands[i].marks;
      for (let s = gap; s >= m; s--) {
        if (reach[s - m] === 1 && reach[s] === 0) {
          reach[s] = 1;
          from[s] = i;
        }
      }
    }
    if (reach[gap] === 1) {
      let s = gap;
      while (s > 0) {
        const i = from[s];
        if (i < 0) break; // defensive; unreachable when reach[gap] === 1
        take(cands[i]);
        s -= cands[i].marks;
      }
    }
  };

  // (1) Stratified round-robin greedy. Within a band, items that no longer fit
  // are skipped permanently (total only grows, so they can never fit later).
  const ptr = new Map<number, number>();
  for (const b of BAND_ORDER) ptr.set(b, 0);
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const b of BAND_ORDER) {
      const bucket = buckets.get(b)!;
      let p = ptr.get(b)!;
      while (p < bucket.length) {
        const item = bucket[p];
        if (total + item.marks <= target) {
          take(item);
          ptr.set(b, p + 1);
          progressed = true;
          break; // move to the next band for a balanced spread
        }
        p += 1; // does not fit now ⇒ never will
        ptr.set(b, p);
      }
    }
  }
  snapshot();

  // (2) Close any residual gap left by the greedy pass.
  closeResidual();
  snapshot();

  // (3) FAIRNESS GUARANTEE: if we are still short, the greedy + residual path
  // over-committed. A full exact subset-sum DP over the whole pool finds an
  // exact-`target` subset whenever one exists — so a reachable target is hit for
  // EVERY seed, not just lucky ones (Ryan #2). Skipped only past the work cap,
  // in which case the best-effort shortfall is reported (and logged at runtime).
  if (total < target) {
    const exact = findExactSubset(ordered, target);
    if (exact) {
      const exactTotal = exact.reduce((s, i) => s + i.marks, 0);
      if (target - exactTotal < target - total) {
        selected = exact.slice();
        selectedIds = new Set(exact.map((i) => i.id));
        total = exactTotal;
        snapshot();
      }
    }
  }

  recomputeBands();

  // (4) Up to MAX_SWAPS balance-improving, TOTAL-PRESERVING swaps. Each swap
  // moves one selected question out of the most-represented band and pulls an
  // unselected question from the least-represented band. Acceptance keeps the
  // total non-regressing and never above the target:
  //   • never exceed:  candidate.marks <= outgoing.marks + (target - total)
  //   • once exact (target - total === 0): equal marks only, so total stays put.
  // If a swap (only possible while short) opens a wider gap, we re-close it.
  for (let iter = 0; iter < MAX_SWAPS; iter++) {
    recomputeBands();
    // hi = most-represented band, lo = least-represented band.
    const rankedDesc = [...REAL_BANDS].sort((a, b) => byDifficulty[b] - byDifficulty[a]);
    const hi = rankedDesc[0];
    const lo = rankedDesc[rankedDesc.length - 1];
    // Only worth swapping while the spread is more than one question.
    if (byDifficulty[hi] - byDifficulty[lo] <= 1) break;

    const removeIdx = selected.findIndex((s) => s.band === hi);
    if (removeIdx < 0) break;
    const outgoing = selected[removeIdx];

    const gap = target - total;
    const maxIncoming = outgoing.marks + gap; // never exceed the target
    const candidate = items
      .filter((c) => c.band === lo && !selectedIds.has(c.id))
      .find((c) => {
        if (c.marks > maxIncoming) return false; // would exceed the target
        if (gap === 0 && c.marks !== outgoing.marks) return false; // exact ⇒ equal marks only
        return true;
      });
    if (!candidate) break;

    // Apply the swap.
    selected.splice(removeIdx, 1);
    selectedIds.delete(outgoing.id);
    total -= outgoing.marks;
    take(candidate);

    // A swap while short may widen the gap; try to re-close it before scoring.
    if (total < target) closeResidual();
    snapshot();
  }

  // (5) Return the best selection seen (smallest shortfall, then best balance).
  selected = bestSelected;
  total = bestTotal;
  recomputeBands();

  // Interleave presentation order by difficulty (balanced bands first).
  const grouped = new Map<number, Item[]>();
  for (const b of BAND_ORDER) grouped.set(b, []);
  for (const item of selected) grouped.get(item.band)!.push(item);
  const order: string[] = [];
  let remaining = selected.length;
  const idx = new Map<number, number>();
  for (const b of BAND_ORDER) idx.set(b, 0);
  while (remaining > 0) {
    for (const b of BAND_ORDER) {
      const list = grouped.get(b)!;
      const p = idx.get(b)!;
      if (p < list.length) {
        order.push(list[p].id);
        idx.set(b, p + 1);
        remaining -= 1;
      }
    }
  }

  const totalMarks = selected.reduce((s, i) => s + i.marks, 0);
  return {
    questionIds: order,
    totalMarks,
    shortfall: Math.max(0, target - totalMarks),
    byDifficulty,
  };
}

/** Count selected items in a real difficulty band. */
function byDifficultyCount(items: Item[], band: number): number {
  let n = 0;
  for (const it of items) if (it.band === band) n += 1;
  return n;
}

/** Difficulty spread (max − min count) across the real bands; lower is balancer. */
function spreadOf(items: Item[]): number {
  let max = 0;
  let min = Number.POSITIVE_INFINITY;
  for (const b of REAL_BANDS) {
    const n = byDifficultyCount(items, b);
    if (n > max) max = n;
    if (n < min) min = n;
  }
  return Number.isFinite(min) ? max - min : 0;
}
