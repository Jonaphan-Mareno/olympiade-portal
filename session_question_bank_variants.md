# Session Record — Question-Bank Variants, Difficulty, Physical Selection & Publish Guard

**Project:** Olympiad Portal (`/home/vmuser/Olympiad-Portal`)
**Date:** 2026-10-07
**Branch:** `feat/question-bank` (work uncommitted at session end — see Outstanding Items)
**Delivery model:** Multi-agent orchestration (AI leader + specialized AI subagents), human-directed

## AI Declaration

All code, database migrations, tests, and documentation produced during this session were generated and/or reviewed with the assistance of multiple AI models and specialized AI agents — spanning research, planning, implementation, code review, verification, and documentation — coordinated by an AI orchestrator. This work was carried out under the direction and final review of the developers, who defined the feature requirements, answered the design clarifications, approved the implementation plan, and remain responsible for the delivered changes and their commit and deployment.

## 1. Objective

Rework round authoring and the online sitting flow so that:

- Each round has a question pool; **online** entrants are each dealt a difficulty-balanced random **variant** filled to an organiser-set **target total marks**, frozen on the sitting and used for resume, marking, results and PDF.
- Every online question carries an organiser-assigned **difficulty 1–5** that drives the balanced draw.
- **Physical** papers are an organiser-hand-picked, ordered subset of the same pool (no variants, no difficulty); bulk offline marking is unchanged.
- Grading, percentages and advancement all use the **fixed target total** (one denominator source of truth) so different variants stay directly comparable.
- A **publish-time readiness guard** blocks finalizing a round when any used question is missing a mark/difficulty or the target is unreachable (drafts may omit marks).

## 2. Locked Requirements (from clarification Q&A)

1. Pool scope = per round.
2. Online variants = per-entrant random draw, persisted and used for marking.
3. Difficulty = organiser-assigned 1–5 (not response-derived); N/A for physical.
4. Difficulty-balanced (stratified) draw.
5. Grading base = organiser-set target total marks.
6. Physical = organiser hand-picks a fixed ordered subset; bulk offline marking unchanged.
7. Missing-mark guard = block publish only.

## 3. Session Phases & Agents

| Phase | Work | Agents (role) |
|---|---|---|
| Investigation | Repo survey: domain/data/lib, routes/components/roles, testing/CI/docs | Alex, Sam, Jack (research) |
| Planning | 3 design lenses (simplicity, performance, minimal-change) → synthesis → approved plan | Alex, Sam, Jack (research) |
| Implementation | T-A schema+migration; T-B domain core; T-C online sitting; T-D organiser authoring | Lee, Taylor, Felix, Jay (coding) |
| Verification | tsc / vitest / lint / build + smoke | Chris (verify) |
| Ultra Review | 3 parallel passes: completeness / correctness / impact | Mark, Ryan, Daniel (code review) |
| Remediation | Migration applied; all Critical/High/Medium findings fixed | Lee, Taylor, Jimmy, Bill, Robin, James (coding) |
| State audit | Build-state + documentation inventory investigation | Eric (research) |
| Documentation | API + DB + feature/testing/roadmap docs | Jason, Nick (coding) |
| Final gate | tsc / 509 tests / lint / production build | Terry (verify) |

## 4. What Was Built

### Data model — migration `0013_question_bank_variants` (purely additive; all new columns nullable)

- `questions.marks` → nullable; `questions.difficulty` (integer, 1–5).
- `rounds.targetTotalMarks` (integer) — unified grading base + online draw target (`paperTotalMarks` retained as a legacy fallback).
- `questionPapers.selectedQuestionIds` (jsonb, ordered) — the fixed physical paper.
- `examSittings.variantQuestionIds` (jsonb) + `variantSeed` (text) — the frozen dealt variant.
- `submissions.variantQuestionIds` (jsonb) — denormalized copy for join-free result pages.
- Four hardening indexes: `questions_round_idx` (INCLUDE marks,difficulty), `question_papers_round_uniq`, `exam_sittings_active_uniq` (partial), `submissions_student_round_idx`.

### Domain layer (pure / DB-free where noted)

- `variant-generator.ts` — `drawVariant` (stratified greedy + residual subset-sum DP + exact-subset fallback + total-preserving swaps, returns best-so-far; never exceeds target; never throws) and `mulberry32`.
- `publish-readiness.ts` — `checkOnlinePublishReadiness(pool, targetTotal)`, `checkPhysicalPublishReadiness`, seed-independent `canReachExactly`, `nearestAchievableTotals`, `FIXED_SEED`.
- `load-variant.ts` — `loadSittingQuestions`, `loadPaperQuestions`, lossless `orderByIds` + strict `orderByIdsStrict`.
- `score-percentage.ts` — `getRoundTotalMarks` single-denominator precedence: targetTotalMarks > selectedQuestionIds sum > whole-pool sum > paperTotalMarks > 0.

### Online sitting flow

- **start:** race-free, resume-first, draw-only-on-create inside a transaction; persists variant + seed; re-draws on shortfall.
- **save:** variant-membership enforcement; matching composite keys aggregated under the base UUID; UUID validation (400 on invalid).
- **sync / submit:** variant returned for resume; marking scoped to the variant; denominator = fixed target; variant copied to the submission.
- **ExamInterface:** seeded option shuffle (stable on resume); integer marks.

### Organiser authoring

- QuestionBuilder: difficulty select (online/hybrid) and integer marks.
- create/update actions: persist difficulty / nullable marks / target / selection; id-preserving upsert; server-authoritative publish guard; portal-ownership authorization; legacy-round guard exemption.
- PublishReadinessPanel (advisory) + PhysicalPaperSelector (ordered picker).
- Physical PDF built from the selected subset; organiser/educator-only `?variant=preview`.
- Public API additively exposes `difficulty`.

## 5. Ultra Review Findings → Fixes

| Ref | Severity | Finding | Fix |
|---|---|---|---|
| Ryan 1 | Critical | Balance-swap could reduce an already-exact variant below target | Total-preserving swaps; DP after swaps; return best-so-far |
| Ryan 2 | Critical | Publish-guard reachability was seed-specific (real draws could fall short) | Seed-independent `canReachExactly`; draw guarantees exactness; runtime re-draw |
| Ryan 3 | Critical | Matching composite key written to a UUID column → 500 | Aggregate matching into one row under the base UUID (JSON answerValue); UUID guard |
| Ryan 4 | Critical | Round create/update had no portal authorization (RLS disabled) | Owner-only authz via portal join; live-sitting lock keyed on stored delivery method |
| Ryan 5 | High | Matching questions always auto-marked 0 | Reassemble the matching payload before marking (submit / remarks / display) |
| Ryan 6 | High | `?variant=preview` leaked the whole pool | `orderByIdsStrict` (variant-only) for the preview branch |
| Daniel C1 | Critical | Unique indexes could abort the migration on duplicate rows | Pre-apply duplicate detection (none found); applied cleanly |
| Daniel C2 | Critical | Denominator precedence re-based legacy hybrid rounds | Pool sum now outranks `paperTotalMarks` |
| Daniel H1 | High | Guard blocked editing all legacy online/hybrid rounds | Legacy-round exemption inside the actions |
| Daniel H2 | High | Standings divide-by-zero → Infinity/NaN | Guarded division (em-dash) |
| Mark | Critical/High/Medium | Educator marking/review/results not variant-scoped; student-scores denominator; edit-page AI generator bypassed the guard | All scoped to the variant; single denominator; AI generator aligned (difficulty null, nullable marks) |

## 6. Verification (final gate)

- `npx tsc --noEmit`: clean (0 errors).
- `npx vitest run`: **509 tests / 62 files pass**.
- `npm run lint`: clean.
- `npm run build`: success (23/23 static pages, 56 routes, zero warnings).
- Migration `0013` applied to the configured Supabase DB; new columns/indexes confirmed present; the previously failing `/educator` rounds query works.

## 7. Documentation Delivered

- **API:** `Documentation/docs/Technical Documentation/app-api.md`, `Documentation/docs/Technical Documentation/public-api.md`.
- **DB:** `Documentation/docs/Initial Design & Planning/database-architecture.md`.
- **Supporting:** `Documentation/docs/Technical Documentation/features.md`, `Documentation/docs/Quality Assurance/testing-documentation.md`, `Documentation/docs/Initial Design & Planning/roadmap.mdx`.
- **ERD:** `Documentation/static/img/supabase-schema.svg` regenerated with the new columns.

## 8. Outstanding Items / Recommendations

- **Uncommitted work (highest priority):** `HEAD == origin/main`; ~17 files are untracked (including `drizzle/0013_question_bank_variants.sql` and its snapshot, while `drizzle/meta/_journal.json` is modified and the migration is applied). `git add` everything and commit to create a rollback point — a fresh clone would otherwise fail `db:migrate`. No commit was made automatically.
- Confirm the migration target environment (dev vs production).
- Documentation was validated by inspection, not a Docusaurus compile (`Documentation/node_modules` absent) — run the docs build for certainty.
- Browser end-to-end testing was not run (no seeded staging DB) — a full organiser→student→results→PDF pass on staging is recommended.
- Stray processes still running at session end: a `vitest` watch process and the `next dev` server.
- Avoid `drizzle-kit push` on this schema — the `questions_round_idx` INCLUDE covering columns cannot be expressed in the Drizzle snapshot.

## 9. Key Design Decisions (rejected alternatives)

- Kept `paperTotalMarks` and **added** `targetTotalMarks` (additive) rather than renaming — drizzle-kit would emit DROP+ADD (data loss).
- JSONB variant-on-row instead of a normalized `sitting_questions` table — zero extra reads, atomic single insert.
- Ordered `selectedQuestionIds` instead of a boolean flag — preserves the organiser's paper order.
- Fixed target-total denominator instead of a per-entrant sum — keeps variants comparable for thresholds/advancement.
- Organiser-assigned difficulty instead of response-derived — deterministic over a round's lifetime.
