// The single source of truth for auto-marking an online answer. Used when a
// sitting is submitted, when an educator's moderation re-totals a script,
// and on the student's paper review — so the per-question marks a student
// sees always add up to the score that was stored.
//
// It is also the single source of truth for the ANSWER KEY FORMAT, because the
// writer (save route), the marker (submit route, educator moderation, remarks)
// and the readers (scores/review pages, exam interface) must agree on it:
//
//   * every answer is stored under the BASE question uuid — `question_id` is a
//     uuid column, so the composite `${uuid}_${index}` key the exam UI posts for
//     one pair of a matching question can never be persisted as-is;
//   * a matching question is ONE row whose `answer_value` is a JSON object of
//     pair selections keyed by `${questionUuid}_${pairIndex}` (the same shape
//     the practice interface builds in the browser);
//   * everything else is the plain answer string.

/** The shape of every `*_id` uuid column in this schema. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when a value can be written to a uuid column without a 22P02 error. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

/** The composite key the exam UI posts for one pair of a matching question. */
export function matchingPairKey(questionId: string, index: number): string {
  return `${questionId}_${index}`;
}

/**
 * Split a composite `${questionId}_${index}` key. Returns null when the key is
 * a plain (base) question id — uuids never contain an underscore.
 */
export function splitMatchingKey(
  key: string
): { questionId: string; index: number } | null {
  const match = /^(.+)_(\d+)$/.exec(key);
  if (!match) return null;
  return { questionId: match[1], index: Number(match[2]) };
}

/** The pair index of a key inside a matching payload (`qid_2` or `2`). */
function pairIndexOf(key: string): number | null {
  const match = /(?:^|_)(\d+)$/.exec(key);
  return match ? Number(match[1]) : null;
}

/**
 * The pairs a student selected for a matching question, keyed by pair index.
 * Accepts the canonical composite keys (`{"<qid>_0":"Paris"}`) and bare index
 * keys (`{"0":"Paris"}`) so practice-mode and legacy payloads mark identically.
 * Never throws: anything unparseable yields an empty selection set.
 */
export function getMatchingSelections(
  raw: unknown
): Record<number, string> {
  const selections: Record<number, string> = {};
  if (raw === null || raw === undefined || raw === '') return selections;

  let parsed: unknown = raw;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return selections;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return selections;
  }

  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const index = pairIndexOf(key);
    if (index === null) continue;
    selections[index] = value === null || value === undefined ? '' : String(value);
  }
  return selections;
}

/** The pair options of a matching question as an array (jsonb or JSON text). */
export function matchingPairsOf(q: any): any[] {
  const options = q?.options;
  if (Array.isArray(options)) return options;
  if (typeof options === 'string') {
    try {
      const parsed = JSON.parse(options);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Fold one more pair selection into a matching question's aggregated payload
 * and return the JSON text to persist under the BASE question uuid. Any pairs
 * already stored are preserved, so saving pair 2 never clobbers pair 1.
 */
export function aggregateMatchingAnswer(
  questionId: string,
  existing: string | null | undefined,
  index?: number,
  value?: string
): string {
  const merged: Record<string, string> = {};
  for (const [pairIndex, selection] of Object.entries(getMatchingSelections(existing))) {
    merged[matchingPairKey(questionId, Number(pairIndex))] = selection;
  }
  if (index !== undefined && index !== null) {
    merged[matchingPairKey(questionId, index)] = value ?? '';
  }
  return JSON.stringify(merged);
}

/**
 * The stored answer for one question, reassembled into the canonical shape: the
 * aggregated JSON object for a matching question, the plain string otherwise.
 * Legacy/practice payloads that hold one entry per pair under the composite key
 * `${questionId}_${index}` are folded back into that single object, so marking
 * and display never have to know which of the two shapes they were handed.
 */
export function resolveAnswer(
  answers: Record<string, unknown> | null | undefined,
  questionId: string
): string | undefined {
  if (!answers || typeof answers !== 'object') return undefined;

  const base = answers[questionId];
  const baseValue =
    base === null || base === undefined
      ? undefined
      : typeof base === 'string'
        ? base
        : JSON.stringify(base);

  // Per-pair entries posted/stored under the composite key.
  const pairs: Record<string, string> = {};
  const prefix = `${questionId}_`;
  for (const [key, value] of Object.entries(answers)) {
    if (!key.startsWith(prefix)) continue;
    if (!/^\d+$/.test(key.slice(prefix.length))) continue;
    pairs[key] = value === null || value === undefined ? '' : String(value);
  }
  if (Object.keys(pairs).length === 0) return baseValue;

  const merged: Record<string, string> = {};
  for (const [index, selection] of Object.entries(getMatchingSelections(baseValue))) {
    merged[matchingPairKey(questionId, Number(index))] = selection;
  }
  Object.assign(merged, pairs);
  return JSON.stringify(merged);
}

/**
 * Normalise a whole answer map (a sitting's saved rows or a submission's
 * `answers_json`) to base-question-id keys with aggregated matching payloads.
 * This is the single reassembly step every marker and display page runs before
 * looking a question's answer up by `q.id`.
 */
export function reassembleAnswers(
  answers: Record<string, unknown> | null | undefined
): Record<string, string> {
  const normalized: Record<string, string> = {};
  if (!answers || typeof answers !== 'object') return normalized;

  const baseIds: string[] = [];
  const seen = new Set<string>();
  for (const key of Object.keys(answers)) {
    const baseId = splitMatchingKey(key)?.questionId ?? key;
    if (seen.has(baseId)) continue;
    seen.add(baseId);
    baseIds.push(baseId);
  }

  for (const baseId of baseIds) {
    const value = resolveAnswer(answers, baseId);
    if (value !== undefined) normalized[baseId] = value;
  }
  return normalized;
}

/**
 * Marks earned for one auto-marked question. Free-text questions are
 * marked by educators and always return 0 here.
 */
export function calculateEarnedMarks(
  q: any,
  studentAnsRaw: string | undefined | null
): number {
  const maxMarks = q.marks ?? 1;
  if (q.questionType === 'free_text') return 0; // Handled by educators
  if (!studentAnsRaw) return 0;

  if (q.questionType === 'matching') {
     // Proportional credit: one pair of the question's marks per correct match,
     // so a matching question is never all-or-nothing.
     const selections = getMatchingSelections(studentAnsRaw);
     const pairs = matchingPairsOf(q);
     if (pairs.length === 0) return 0;

     let correctPairs = 0;
     pairs.forEach((pair: any, index: number) => {
        const expected = pair?.response;
        const given = selections[index];
        if (expected === null || expected === undefined) return;
        if (given === undefined || given === '') return;
        // Trimmed, case-insensitive: the same comparison the review screens use
        // to tick a pair green, so displayed ticks and awarded marks agree.
        if (String(given).trim().toLowerCase() === String(expected).trim().toLowerCase()) {
           correctPairs++;
        }
     });
     return (correctPairs / pairs.length) * maxMarks;
  }

  // Common correct answer normalization
  let correctSelections: string[] = [];
  const strCorrect = typeof q.correctAnswer === 'string' || typeof q.correctAnswer === 'number' || typeof q.correctAnswer === 'boolean' ? String(q.correctAnswer) : '';
  try {
      const parsed = JSON.parse(strCorrect);
      correctSelections = Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
  } catch {
      if (!strCorrect.startsWith('[')) {
          correctSelections = strCorrect.split(',').map((s: string) => s.trim()).filter(Boolean);
      } else {
          correctSelections = [strCorrect];
      }
  }
  if (Array.isArray(q.correctAnswer)) {
      correctSelections = q.correctAnswer.map(String);
  } else if (typeof q.correctAnswer === 'object' && q.correctAnswer !== null && (q.correctAnswer as any).text !== undefined) {
      correctSelections = [String((q.correctAnswer as any).text)];
  }

  const studentSelections = parseStudentSelections(q, studentAnsRaw);

  if (q.questionType === 'multiple_choice') {
      const totalCorrect = correctSelections.length;
      if (totalCorrect === 0) return 0;
      let matches = 0;
      studentSelections.forEach(s => {
          if (correctSelections.includes(s)) matches++;
      });
      return (matches / totalCorrect) * maxMarks;
  }

  // single_choice or true_false
  const isCorrect = correctSelections.length === 1 && studentSelections.length === 1 && correctSelections[0] === studentSelections[0];
  if (isCorrect) return maxMarks;
  
  const studentStr = studentSelections.join(',').toLowerCase();
  const correctStr = correctSelections.join(',').toLowerCase();
  if (studentStr === correctStr) return maxMarks;

  return 0;
}

/**
 * A student's selections for a question. Answers may be a JSON array (the
 * practice interface) or, for multi-select questions in the real exam, a
 * comma-joined string such as "He likes lasagna,his humans name is John".
 * Comma-joined answers are matched against the question's options so an
 * option that itself contains a comma is still recognised.
 */
function parseStudentSelections(q: any, raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
    return [String(raw)];
  } catch {
    // not JSON — fall through
  }

  if (q.questionType !== 'multiple_choice') return [raw];

  const options: string[] = Array.isArray(q.options) ? q.options.map(String) : [];
  const padded = `,${raw},`;
  const matched = options.filter((opt) => padded.includes(`,${opt},`));
  if (matched.length > 0) return matched;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}
