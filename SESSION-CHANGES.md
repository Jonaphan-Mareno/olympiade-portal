# Session Changes — Submission Uniqueness & "First Is Final" Guard

**Date:** 2026-10-10
**Scope:** TypeScript import fix, database migration, concurrency guard for the online/offline submission routes, and tests.

---

## 1. Build fix — TS5097 import extension

**File:** `seed-organiser-preview.ts`

- Changed the schema import from `'./src/lib/db/schema/index.ts'` to `'./src/lib/db/schema'`.
- The explicit `.ts` extension triggered `TS5097` because `tsconfig.json` uses `moduleResolution: "bundler"` without `allowImportingTsExtensions`. The extensionless form matches the convention used by every other script in the repo (`seed-test-student.ts`, `db-view.ts`, `clean-db.ts`, `check-*.ts`).

---

## 2. Investigation — convergence of the two submission routes

No code change; findings that motivated the work below.

- **Two routes meet** on the shared `submissions` + `results` tables and a single per-round `question_papers` row (`question_papers_round_uniq`).
- **One paper sittable either way** on `hybrid` rounds (`rounds.deliveryMethod` enum `online | paper | hybrid`).
- **Results merged into a single set** by `getRoundStats`/`computeRoundStats` and `advanceQualifyingEntrants`, neither of which filters by `submissionType`.
- **Entrant dedup:** headcounts (`wrote`, `completed`) and advancement dedupe by `studentMembershipId` via `Set`. **Gap found:** the one-row-per-entrant-per-round invariant was enforced only in application code (no DB constraint), and the score aggregates (`marked`, `averageScore`, `passRate`) count result rows, not distinct students — so a duplicate submission would silently skew averages.

---

## 3. Database migration `0014` — unique index on submissions

**Files:**
- `drizzle/0014_submission_unique.sql` (new)
- `drizzle/meta/0014_snapshot.json` (new)
- `drizzle/meta/_journal.json` (entry `idx: 14`)
- `src/lib/db/schema/index.ts`
- `Documentation/docs/Initial Design & Planning/database-architecture.md`

**Change:** Converted the plain `submissions_student_round_idx` into a **UNIQUE** index `submissions_student_round_uniq` on `(student_membership_id, round_id)`.

- Enforces one submission per entrant per round at the database level — the backstop that prevents a hybrid-round entrant appearing down both routes from being double-counted.
- `student_membership_id` is nullable; Postgres treats NULLs as distinct, so anonymous rows never collide.
- **Migration caveat (documented in the SQL):** pre-existing duplicate `(student_membership_id, round_id)` rows must be de-duplicated first, or `CREATE UNIQUE INDEX` will fail.

---

## 4. Concurrency guard — "first is final"

**File:** `src/app/api/student/sitting/submit/route.ts` (online submit)

- If a **`submitted`** record already exists for the entrant+round (an offline educator mark, or a concurrent online submit that won the race), the route returns early. The sitting is still flagged submitted, but the existing submission's answers, `submissionType`, and mark are **never overwritten**.
- The submission insert now uses `.onConflictDoNothing()` against the new unique index; if a concurrent writer created the row between the SELECT and INSERT, `returning()` yields nothing and the request bows out without marking instead of throwing a unique violation.
- A pre-existing **draft** (status ≠ `submitted`) is still finalized in place, preserving prior behaviour.

**File:** `src/app/educator/rounds/[roundId]/offline-marks/actions.ts` (offline bulk marks)

- The submission insert now uses `.onConflictDoNothing()` + re-read, so a concurrent online submit cannot fail the entire batch with a unique violation.
- If the winning row is an `online` script, it is skipped — reinforcing the existing "never overwrite a script the entrant wrote online" rule.

---

## 5. Tests

**Files:**
- `tests/api/student/sitting.submit.test.ts`
- `tests/api/student/sitting.matching.test.ts`

- Updated both submit-route db mocks so `.onConflictDoNothing().returning(...)` composes like the real Drizzle query builder.
- Added a `conflictOnInsert` flag to simulate losing the insert race.
- New cases:
  - *leaves an offline submission and its mark untouched (first is final)*
  - *bows out without marking when it loses the insert race (concurrent submit)*

---

## Verification (to be run by the maintainer)

Node/npm were not available in the authoring environment, so the following were **not** executed:

```powershell
npx vitest run tests/api/student/sitting.submit.test.ts tests/api/student/sitting.matching.test.ts tests/domain/round-stats.test.ts
npx tsc --noEmit
npm run db:generate   # expected: "No schema changes" — confirms the hand-written 0014 matches the schema
```

---

## AI Declaration

This document and the code changes described in it were produced with the assistance of an AI coding agent (Qoder) working pair-programming with the repository maintainer. The AI agent drafted the migration, schema, route, and test edits and this summary; the maintainer directed the task and is responsible for reviewing, verifying (including running the test/type/migration commands above), and approving all changes before they are relied upon or merged. No claim is made that the AI-generated content is free of errors — human review is required.
