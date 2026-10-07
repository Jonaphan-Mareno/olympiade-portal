import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as saveAnswer } from '@/app/api/student/sitting/save/route';
import { POST as submitSitting } from '@/app/api/student/sitting/submit/route';
import {
  examSittings,
  memberships,
  questionPapers,
  rounds,
  questions,
  studentAnswers,
  submissions,
  results,
} from '@/lib/db/schema';
import { calculateEarnedMarks, isUuid, reassembleAnswers } from '@/domain/marking/auto-mark';

// End-to-end proof that a matching answer survives the whole data path:
// save -> student_answers -> submit -> answers_json -> auto-mark -> results.
//
// The db below is a small in-memory Postgres stand-in rather than the usual
// "record the calls" mock, because the bug this covers is a TYPE bug: the real
// `student_answers.question_id` column is `uuid` (drizzle/0004 adds it as
// `uuid`), so writing the composite `${uuid}_${index}` key the exam UI posts
// fails with 22P02 and the sub-answer is silently lost. The stand-in enforces
// the same uuid column types, the unique (sitting_id, question_id) upsert and
// the jsonb merge the route performs, so a regression to composite-key writes
// fails here exactly as it fails against Postgres.

const PORTAL = '70000000-0000-4000-8000-000000000001';
const SCHOOL = '80000000-0000-4000-8000-000000000001';
const USER = '60000000-0000-4000-8000-000000000001';
const ROUND = '10000000-0000-4000-8000-000000000001';
const PAPER = '20000000-0000-4000-8000-000000000001';
const MEMBERSHIP = '30000000-0000-4000-8000-000000000001';
const SITTING = '40000000-0000-4000-8000-000000000001';
const Q_SINGLE = '50000000-0000-4000-8000-000000000001';
const Q_MATCH = '50000000-0000-4000-8000-000000000002';
const Q_FREE = '50000000-0000-4000-8000-000000000003';

// The matching question's pairs: France->Paris, Italy->Rome, Spain->Madrid.
const MATCH_PAIRS = [
  { premise: 'France', response: 'Paris' },
  { premise: 'Italy', response: 'Rome' },
  { premise: 'Spain', response: 'Madrid' },
];

const h = vi.hoisted(() => {
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // uuid columns per table, mirroring src/lib/db/schema/index.ts.
  const UUID_FIELDS: Record<string, string[]> = {
    examSittings: ['id', 'studentMembershipId', 'questionPaperId'],
    memberships: ['id', 'userId', 'portalId', 'schoolId'],
    questionPapers: ['id', 'roundId'],
    rounds: ['id', 'portalId'],
    questions: ['id', 'roundId'],
    studentAnswers: ['id', 'sittingId', 'questionId'],
    submissions: ['id', 'studentMembershipId', 'roundId'],
    results: ['id', 'submissionId'],
  };

  const state = {
    store: {} as Record<string, any[]>,
    tableNames: new Map<any, string>(),
    // Every row the routes tried to write, so a test can assert nothing ever
    // carried a composite key into a uuid column.
    attempted: [] as Array<{ table: string; row: any }>,
  };

  const camel = (db: string) => db.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

  const nameOf = (table: any): string => state.tableNames.get(table) ?? 'unknown';

  const isColumn = (v: any) => Boolean(v) && typeof v === 'object' && v.table && typeof v.name === 'string' && 'columnType' in v;
  const isTable = (v: any) => Boolean(v) && typeof v === 'object' && state.tableNames.has(v);
  const isSql = (v: any) => Boolean(v) && typeof v === 'object' && Array.isArray(v.queryChunks);

  function uuidViolation(field: string, value: unknown) {
    const err: any = new Error(
      `invalid input syntax for type uuid: "${String(value)}" (column ${field})`
    );
    err.code = '22P02';
    return err;
  }

  function assertUuidColumns(tableName: string, row: any) {
    for (const field of UUID_FIELDS[tableName] ?? []) {
      const value = row?.[field];
      if (value === null || value === undefined) continue;
      if (typeof value !== 'string' || !UUID_RE.test(value)) {
        throw uuidViolation(field, value);
      }
    }
  }

  type Cond = { table: any; field: string; values: any[] };

  /** Flatten a Drizzle SQL tree into (column, values) equality conditions. */
  function conditions(node: any, out: Cond[] = []): Cond[] {
    if (!node || typeof node !== 'object' || !Array.isArray(node.queryChunks)) return out;
    let column: any = null;
    const visit = (n: any) => {
      if (!n || typeof n !== 'object') return;
      if (isColumn(n)) {
        column = n;
        return;
      }
      if ('value' in n && 'encoder' in n && column) {
        const field = camel(column.name);
        const last = out[out.length - 1];
        if (last && last.table === column.table && last.field === field) last.values.push(n.value);
        else out.push({ table: column.table, field, values: [n.value] });
        return;
      }
      if (Array.isArray(n.queryChunks)) n.queryChunks.forEach(visit);
    };
    node.queryChunks.forEach(visit);
    return out;
  }

  function matches(
    row: any,
    from: any,
    joins: any[],
    conds: Cond[]
  ): boolean {
    for (const cond of conds) {
      const owner =
        cond.table === from ? row : (state.store[nameOf(cond.table)] ?? [])[0] ?? null;
      if (!owner) return false;
      if (!cond.values.some((v) => owner[cond.field] === v)) return false;
    }
    return true;
  }

  function project(row: any, fields: any): any {
    if (!fields) return { ...row };
    const out: any = {};
    for (const [key, spec] of Object.entries(fields)) {
      if (isTable(spec)) out[key] = { ...(state.store[nameOf(spec)] ?? [])[0] };
      else if (isColumn(spec)) out[key] = row[camel((spec as any).name)];
    }
    return out;
  }

  /** Applies an UPDATE/ON CONFLICT set, emulating the route's jsonb merge. */
  function applySet(tableName: string, existing: any, set: any, excluded: any) {
    for (const [field, value] of Object.entries(set ?? {})) {
      if (isSql(value)) {
        // Mirrors: CASE WHEN answer_value IS NULL OR left(answer_value,1) <> '{'
        //              THEN excluded.answer_value
        //              ELSE (answer_value::jsonb || excluded.answer_value::jsonb)::text END
        const current = existing[field];
        const incoming = excluded[field];
        existing[field] =
          typeof current === 'string' && current.trim().startsWith('{')
            ? JSON.stringify({ ...JSON.parse(current), ...JSON.parse(incoming) })
            : incoming;
        continue;
      }
      existing[field] = value;
    }
    assertUuidColumns(tableName, existing);
  }

  const db = {
    select: (fields?: any) => {
      let from: any = null;
      const joins: any[] = [];
      let conds: Cond[] = [];
      let limitN: number | null = null;

      const run = () => {
        const rows = (state.store[nameOf(from)] ?? []).filter((row) =>
          matches(row, from, joins, conds)
        );
        const limited = limitN === null ? rows : rows.slice(0, limitN);
        return limited.map((row) => {
          if (!fields) return { ...row };
          const out: any = {};
          for (const [key, spec] of Object.entries(fields)) {
            if (isTable(spec)) {
              out[key] = spec === from ? { ...row } : { ...(state.store[nameOf(spec)] ?? [])[0] };
            } else if (isColumn(spec)) {
              const ownerTable = (spec as any).table;
              const owner =
                ownerTable === from ? row : (state.store[nameOf(ownerTable)] ?? [])[0] ?? null;
              out[key] = owner ? owner[camel((spec as any).name)] : null;
            }
          }
          return out;
        });
      };

      const chain: any = {
        from: (t: any) => {
          from = t;
          return chain;
        },
        innerJoin: (t: any) => {
          joins.push(t);
          return chain;
        },
        leftJoin: (t: any) => {
          joins.push(t);
          return chain;
        },
        where: (sqlObj: any) => {
          conds = conditions(sqlObj);
          return chain;
        },
        orderBy: () => chain,
        limit: (n: number) => {
          limitN = n;
          return chain;
        },
        then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
      };
      return chain;
    },

    update: (table: any) => ({
      set: (values: any) => ({
        where: (sqlObj: any) => {
          const conds = conditions(sqlObj);
          const tableName = nameOf(table);
          (state.store[tableName] ?? [])
            .filter((row) => matches(row, table, [], conds))
            .forEach((row) => applySet(tableName, row, values, row));
          return Promise.resolve();
        },
      }),
    }),

    insert: (table: any) => ({
      values: (input: any) => {
        const tableName = nameOf(table);
        const rows: any[] = Array.isArray(input) ? input : [input];
        let done: any[] | null = null;

        const apply = (options: any): any[] => {
          if (done) return done;
          const affected: any[] = [];
          for (const input of rows) {
            // The type check Postgres performs before the row is written.
            assertUuidColumns(tableName, input);
            state.attempted.push({ table: tableName, row: { ...input } });

            const row = {
              id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`,
              ...input,
            };

            if (options?.target) {
              const targetFields = options.target.map((c: any) => camel(c.name));
              const existing = (state.store[tableName] ?? []).find((r) =>
                targetFields.every((f: string) => r[f] === row[f])
              );
              if (existing) {
                applySet(tableName, existing, options.set, row);
                affected.push(existing);
                continue;
              }
            }

            assertUuidColumns(tableName, row);
            (state.store[tableName] ??= []).push(row);
            affected.push(row);
          }
          done = affected;
          return affected;
        };

        const terminal: any = {
          onConflictDoUpdate: (options: any) => Promise.resolve(apply(options)),
          onConflictDoNothing: () => Promise.resolve(apply(null)),
          returning: (fields?: any) =>
            Promise.resolve(apply(null).map((row) => project(row, fields))),
          then: (res: any, rej: any) => Promise.resolve(apply(null)).then(res, rej),
        };
        return terminal;
      },
    }),
  };

  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
  };

  return { state, db, supabase, nameOf, camel };
});

// Table identities are injected after import (vi.hoisted runs first).
h.state.tableNames.set(examSittings, 'examSittings');
h.state.tableNames.set(memberships, 'memberships');
h.state.tableNames.set(questionPapers, 'questionPapers');
h.state.tableNames.set(rounds, 'rounds');
h.state.tableNames.set(questions, 'questions');
h.state.tableNames.set(studentAnswers, 'studentAnswers');
h.state.tableNames.set(submissions, 'submissions');
h.state.tableNames.set(results, 'results');

vi.mock('@/lib/db', () => ({ db: h.db }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => h.supabase,
}));

// --- fixtures --------------------------------------------------------------

const matchQuestion = {
  id: Q_MATCH,
  roundId: ROUND,
  questionType: 'matching',
  prompt: 'Match each country to its capital',
  marks: 6,
  options: MATCH_PAIRS,
  correctAnswer: null,
};

function seed() {
  const now = Date.now();
  h.state.store = {
    rounds: [
      {
        id: ROUND,
        portalId: PORTAL,
        name: 'Round 1',
        opensAt: new Date(now - 60 * 60_000),
        closesAt: new Date(now + 3 * 24 * 60 * 60_000),
        resultsPublishedAt: null,
        // The round's fixed target total is the single grading denominator.
        targetTotalMarks: 12,
        paperTotalMarks: null,
      },
    ],
    questionPapers: [
      { id: PAPER, roundId: ROUND, durationMinutes: 60, selectedQuestionIds: null },
    ],
    memberships: [
      {
        id: MEMBERSHIP,
        userId: USER,
        portalId: PORTAL,
        schoolId: SCHOOL,
        role: 'student',
        status: 'accepted',
      },
    ],
    examSittings: [
      {
        id: SITTING,
        studentMembershipId: MEMBERSHIP,
        questionPaperId: PAPER,
        status: 'active',
        startedAt: new Date(now - 5 * 60_000),
        endedAt: null,
        variantQuestionIds: [Q_SINGLE, Q_MATCH, Q_FREE],
        variantSeed: 'seed-1',
      },
    ],
    questions: [
      {
        id: Q_SINGLE,
        roundId: ROUND,
        questionType: 'single_choice',
        prompt: 'Pick B',
        marks: 2,
        options: ['A', 'B'],
        correctAnswer: 'B',
      },
      matchQuestion,
      {
        id: Q_FREE,
        roundId: ROUND,
        questionType: 'free_text',
        prompt: 'Explain your reasoning',
        marks: 4,
        options: null,
        correctAnswer: { memo: 'Because.' },
      },
    ],
    studentAnswers: [],
    submissions: [],
    results: [],
  };
  h.state.attempted = [];
}

function post(url: string, body: Record<string, any>) {
  return new Request(`http://localhost:3000${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const save = (questionId: string, answerValue: string) =>
  saveAnswer(post('/api/student/sitting/save', { sittingId: SITTING, questionId, answerValue }));

const storedAnswers = () => h.state.store.studentAnswers;

beforeEach(() => {
  vi.clearAllMocks();
  seed();
});

describe('matching answers: save -> submit -> auto-mark', () => {
  it('persists every pair of a matching question in ONE row under the base uuid', async () => {
    for (const [index, response] of ['Paris', 'Rome', 'Madrid'].entries()) {
      const res = await save(`${Q_MATCH}_${index}`, response);
      expect(res.status).toBe(200);
    }

    const rows = storedAnswers();
    expect(rows).toHaveLength(1);
    expect(rows[0].questionId).toBe(Q_MATCH);
    expect(JSON.parse(rows[0].answerValue)).toEqual({
      [`${Q_MATCH}_0`]: 'Paris',
      [`${Q_MATCH}_1`]: 'Rome',
      [`${Q_MATCH}_2`]: 'Madrid',
    });

    // Nothing ever tried to write the composite key into the uuid column.
    for (const attempt of h.state.attempted) {
      if (attempt.table !== 'studentAnswers') continue;
      expect(isUuid(attempt.row.questionId)).toBe(true);
      expect(attempt.row.questionId).not.toMatch(/_\d+$/);
    }
  });

  it('would reject a composite key written straight to the uuid column (the failure this fix removes)', async () => {
    // Documents why the route aggregates: the column type itself refuses the
    // transport key, so the old write path lost every matching sub-answer.
    await expect(
      h.db.insert(studentAnswers).values({
        sittingId: SITTING,
        questionId: `${Q_MATCH}_0`,
        answerValue: 'Paris',
      })
    ).rejects.toThrow(/invalid input syntax for type uuid/);
  });

  it('auto-marks the matching question from the persisted aggregate on submit', async () => {
    await save(Q_SINGLE, 'B'); // correct -> 2
    await save(`${Q_MATCH}_0`, 'Paris'); // correct
    await save(`${Q_MATCH}_1`, 'Rome'); // correct
    await save(`${Q_MATCH}_2`, 'Berlin'); // wrong (Madrid) -> 2/3 * 6 = 4
    await save(Q_FREE, 'A long written explanation'); // educator-marked -> excluded

    const res = await submitSitting(post('/api/student/sitting/submit', { sittingId: SITTING }));
    expect(res.status).toBe(200);

    const [result] = h.state.store.results;
    expect(result).toBeTruthy();
    expect(result.status).toBe('auto_marked');
    // 2 (single choice) + 4 (two of three pairs) = 6 out of the round target 12.
    expect(result.score).toBe('6');
    expect(result.feedback).toBe('Auto-marked: 6 / 12');

    // The submission's answers_json is keyed by base question id only, with the
    // matching payload aggregated — that is what every reader looks up by q.id.
    const [submission] = h.state.store.submissions;
    const answersJson = submission.answersJson as Record<string, string>;
    expect(Object.keys(answersJson).sort()).toEqual([Q_FREE, Q_MATCH, Q_SINGLE].sort());
    expect(JSON.parse(answersJson[Q_MATCH])).toEqual({
      [`${Q_MATCH}_0`]: 'Paris',
      [`${Q_MATCH}_1`]: 'Rome',
      [`${Q_MATCH}_2`]: 'Berlin',
    });
    expect(submission.variantQuestionIds).toEqual([Q_SINGLE, Q_MATCH, Q_FREE]);
  });

  it('round-trips: re-marking the stored answers_json reproduces the stored score', async () => {
    await save(Q_SINGLE, 'B');
    await save(`${Q_MATCH}_0`, 'Paris');
    await save(`${Q_MATCH}_1`, 'Rome');
    await save(`${Q_MATCH}_2`, 'Berlin');
    await submitSitting(post('/api/student/sitting/submit', { sittingId: SITTING }));

    const [submission] = h.state.store.submissions;
    const answers = reassembleAnswers(submission.answersJson as Record<string, string>);

    // The matching marks a reviewer recomputes equal what submit stored.
    expect(calculateEarnedMarks(matchQuestion, answers[Q_MATCH])).toBe(4);
    expect(h.state.store.results[0].score).toBe('6');
  });

  it('keeps matching at zero without failing the submission when nothing was chosen', async () => {
    await save(Q_SINGLE, 'A'); // wrong -> 0

    const res = await submitSitting(post('/api/student/sitting/submit', { sittingId: SITTING }));
    expect(res.status).toBe(200);

    expect(h.state.store.results[0].score).toBe('0');
    expect(h.state.store.results[0].feedback).toBe('Auto-marked: 0 / 12');
  });

  it('awards full marks when every pair is matched', async () => {
    for (const [index, pair] of MATCH_PAIRS.entries()) {
      await save(`${Q_MATCH}_${index}`, pair.response);
    }

    await submitSitting(post('/api/student/sitting/submit', { sittingId: SITTING }));

    // 6 marks for the matching question, nothing else answered.
    expect(h.state.store.results[0].score).toBe('6');
  });

  it('lets a student change a pair without losing the other pairs', async () => {
    await save(`${Q_MATCH}_0`, 'Berlin');
    await save(`${Q_MATCH}_1`, 'Rome');
    await save(`${Q_MATCH}_0`, 'Paris'); // changed their mind

    await submitSitting(post('/api/student/sitting/submit', { sittingId: SITTING }));

    expect(JSON.parse(storedAnswers()[0].answerValue)).toEqual({
      [`${Q_MATCH}_0`]: 'Paris',
      [`${Q_MATCH}_1`]: 'Rome',
    });
    // Both remaining pairs correct -> 2/3 * 6 = 4.
    expect(h.state.store.results[0].score).toBe('4');
  });
});
