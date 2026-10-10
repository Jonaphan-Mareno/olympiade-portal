// The memo (answer key) of a round's paper, as data. The printable memo PDF
// (lib/pdf/online-test-pdf) and the entrant's on-screen memo beside their
// marked script are both built from this, so they always agree — including
// the option letters and the shuffled Column B of matching questions.

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const letter = (i: number) => LETTERS[i] ?? String(i + 1);

/**
 * Deterministic shuffle so the paper and memo agree on the order of the
 * matching responses without needing to persist anything.
 */
export function seededOrder(length: number, seed: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rand = () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const order = Array.from({ length }, (_, i) => i);
  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** An option's display text (options are plain strings, or { text } objects). */
export function optionText(o: unknown): string {
  if (typeof o === 'string') return o;
  if (o && typeof o === 'object' && (o as { text?: unknown }).text !== undefined) {
    return String((o as { text: unknown }).text);
  }
  return String(o);
}

/**
 * The correct option(s) of a choice question, as option texts. The answer is
 * stored in several shapes (a string, a JSON array string, a comma-separated
 * string, an array, or { text }); this reads them the way the auto-marker does,
 * but prefers an exact option match so an option that itself contains a comma
 * is not split.
 */
export function correctChoices(correct: unknown, options: string[]): string[] {
  const canon = (c: string) =>
    options.find((o) => o.trim().toLowerCase() === c.trim().toLowerCase()) ?? c.trim();

  let raw: string[] = [];
  if (Array.isArray(correct)) {
    raw = correct.map(optionText);
  } else if (correct && typeof correct === 'object') {
    const text = (correct as { text?: unknown }).text;
    raw = Array.isArray(text) ? text.map(String) : text !== undefined ? [String(text)] : [];
  } else if (correct !== null && correct !== undefined && String(correct).trim() !== '') {
    const str = String(correct);
    if (options.some((o) => o.trim().toLowerCase() === str.trim().toLowerCase())) {
      raw = [str];
    } else {
      try {
        const parsed = JSON.parse(str);
        raw = Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
      } catch {
        raw = str.includes(',') ? str.split(',') : [str];
      }
    }
  }
  return raw.map((c) => c.trim()).filter(Boolean).map(canon);
}

/** A free-text marking guideline, whatever shape it was stored in. */
function guidelineOf(correct: unknown): string | null {
  if (correct === null || correct === undefined) return null;
  if (typeof correct === 'string') return correct.trim() || null;
  if (Array.isArray(correct)) return correct.map(String).join('\n') || null;
  if (typeof correct === 'object') {
    const o = correct as { text?: unknown; memo?: unknown };
    const value = o.text ?? o.memo;
    if (value === undefined) return null;
    return Array.isArray(value) ? value.map(String).join('\n') : String(value);
  }
  return String(correct);
}

export type MemoQuestionInput = {
  id: string;
  type: string;
  prompt: string;
  marks: number | string | null;
  options: unknown;
  correctAnswer: unknown;
};

export type MemoEntry = {
  number: number;
  prompt: string;
  marks: number;
  type: string;
  /** Choice questions: every option, as lettered on the paper */
  options: { letter: string; text: string; correct: boolean }[];
  /** Short answer line, e.g. "B, D" or "True"; null when none was set */
  answer: string | null;
  /** Matching questions: Column A item → its Column B letter and text */
  pairs: { premise: string; letter: string; response: string }[];
  /** Free-text questions: the marking guideline */
  guideline: string | null;
};

const marksOf = (q: MemoQuestionInput) => Number(q.marks) || 1;

/** The memo for an ordered list of paper questions. */
export function buildMemoEntries(questions: MemoQuestionInput[]): MemoEntry[] {
  return questions.map((q, i) => {
    const opts: unknown[] = Array.isArray(q.options) ? q.options : [];
    const entry: MemoEntry = {
      number: i + 1,
      prompt: q.prompt || '',
      marks: marksOf(q),
      type: q.type,
      options: [],
      answer: null,
      pairs: [],
      guideline: null,
    };

    switch (q.type) {
      case 'single_choice':
      case 'multiple_choice': {
        const texts = opts.map(optionText);
        const correct = correctChoices(q.correctAnswer, texts);
        entry.options = texts.map((text, oi) => ({
          letter: letter(oi),
          text,
          correct: correct.includes(text),
        }));
        const letters = correct.map((c) => {
          const idx = texts.indexOf(c);
          return idx >= 0 ? letter(idx) : c;
        });
        entry.answer = letters.length ? letters.join(', ') : null;
        break;
      }
      case 'true_false': {
        const [answer] = correctChoices(q.correctAnswer, ['True', 'False']);
        entry.answer = answer
          ? `${answer.charAt(0).toUpperCase()}${answer.slice(1).toLowerCase()}`
          : null;
        break;
      }
      case 'matching': {
        const order = seededOrder(opts.length, q.id);
        entry.pairs = opts.map((p, pi) => {
          const pair = (p ?? {}) as { premise?: unknown; response?: unknown };
          return {
            premise: String(pair.premise ?? ''),
            letter: letter(order.indexOf(pi)),
            response: String(pair.response ?? ''),
          };
        });
        break;
      }
      case 'free_text':
      default:
        entry.guideline = guidelineOf(q.correctAnswer);
        break;
    }
    return entry;
  });
}
