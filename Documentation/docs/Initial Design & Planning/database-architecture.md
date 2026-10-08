# Database Architecture

## Schema Documentation

![Supabase Database Schema](/img/supabase-schema.svg)

Our system uses a strictly normalized PostgreSQL relational database to ensure absolute data integrity between users, educational institutions, and complex Olympiad events. The schema is defined, version-controlled, and managed via **Drizzle ORM**.

### Core Entities & Relationships

| Table Name | Primary Purpose | Key Foreign Keys (Relationships) | Critical Fields |
| :--- | :--- | :--- | :--- |
| **`users`** | Central identity mapping | `id` → `auth.users.id` (Supabase Auth) | `email`, `name`, `isPlatformAdmin` |
| **`portals`** | Represents Olympiad organizing bodies | `ownerUserId` → `users.id` | `name`, `status` |
| **`schools`** | Participating educational institutions | `portalId` → `portals.id` | `name` |
| **`memberships`** | The authorization nexus mapping users to roles | `userId` → `users.id`<br/>`portalId` → `portals.id`<br/>`schoolId` → `schools.id` | `role` (e.g., admin, student), `status`, `inviteToken` |
| **`organiser_applications`** | Tracks applications to become organizers | `userId` → `users.id` | `pdfUrl`, `status` |
| **`rounds`** | Distinct phases of a competition | `portalId` → `portals.id` | `name`, `deliveryMethod`, `opensAt`, `targetTotalMarks` |
| **`question_papers`** | Contains the actual test material | `roundId` → `rounds.id` | `fileUrl`, `isMultipleChoice`, `selectedQuestionIds` |
| **`questions`** | Individual questions for online exams | `roundId` → `rounds.id` | `prompt`, `marks` (nullable), `questionType`, `difficulty` |
| **`exam_sittings`** | Tracks live online exam sessions | `studentMembershipId` → `memberships.id`<br/>`questionPaperId` → `question_papers.id` | `startedAt`, `status`, `variantQuestionIds`, `variantSeed` |
| **`student_answers`** | Individual answers for online exams | `sittingId` → `exam_sittings.id`<br/>`questionId` → `questions.id` | `answerValue`, `savedAt` |
| **`submissions`** | Wraps offline/online answers for grading | `roundId` → `rounds.id`<br/>`studentMembershipId` → `memberships.id` | `submissionType`, `fileUrl`, `variantQuestionIds` |
| **`results`** | Final graded scores | `submissionId` → `submissions.id` | `score`, `status`, `feedback` |
| **`round_qualifications`** | Records which students have advanced into a given round (written when the previous round's results are published) | `roundId` → `rounds.id`<br/>`studentMembershipId` → `memberships.id` | `qualifiedAt`; unique on (`roundId`, `studentMembershipId`) |
| **`notification_log`** | Audit log for sent emails/notifications | `roundId` → `rounds.id`<br/>`recipientMembershipId` → `memberships.id` | `kind`, `status`, `sentAt` |
| **`certificate_templates`** | Designs for round-specific certificates | `roundId` → `rounds.id` | `minScorePercentage`, `templateUrl` |
| **`in_app_notifications`** | User-specific notifications | `userId` → `users.id` | `title`, `isRead` |
| **`automation_rules`** | Triggers for automated portal actions | `portalId` → `portals.id` | `triggerType`, `isActive` |

### Question-Bank Variants & Difficulty

The **question-bank variants** feature lets a single round support per-entrant online papers, hand-picked physical papers, and organiser-tuned difficulty — while keeping the schema strictly normalized. Every column below was added as **nullable**, so existing rows keep their legacy behaviour (`null` = "fall back to the whole pool / legacy marks").

- **`rounds.targetTotalMarks`** (integer, nullable): the unified grading base and the online-variant draw target. Percentages, mark validation, and advancement all resolve against it. `rounds.paperTotalMarks` is retained purely as a **legacy read fallback** (used when `targetTotalMarks` is `null`).
- **`question_papers.selectedQuestionIds`** (jsonb, nullable): an ordered array of question UUIDs representing the **fixed physical paper selection**. `null` preserves the legacy whole-pool behaviour.
- **`questions.difficulty`** (integer, nullable): the **organiser-assigned difficulty rating (1–5)** used to build difficulty-balanced online/hybrid variants. It is `null` for physical/legacy questions. Difficulty is author-assigned, **not** derived from entrant responses.
- **`questions.marks`** is now **NULLABLE** — draft questions may omit a mark. Migration `0013` performs `ALTER COLUMN "marks" DROP NOT NULL`, which preserves every existing value.
- **`exam_sittings.variantQuestionIds`** (jsonb, nullable): the ordered variant actually **dealt** to the student; it is authoritative for the duration of the attempt.
- **`exam_sittings.variantSeed`** (text, nullable): a stable option-shuffle seed so answer options render in the same order when a student resumes an interrupted sitting.
- **`submissions.variantQuestionIds`** (jsonb, nullable): a **denormalized copy** of the dealt variant, written at submit time so results/review/remarks pages stay join-free and immutable even if the pool later changes.
- **`student_answers` (matching questions):** no schema change was made. A matching question is stored as **one row** under the base question UUID, whose `answerValue` is an aggregated JSON object of the pair selections keyed `${questionId}_${pairIndex}`.

### Indexes

Migration `0013_question_bank_variants` adds four indexes alongside the new columns:

| Index | Table | Definition | Purpose |
| :--- | :--- | :--- | :--- |
| `questions_round_idx` | `questions` | btree (`round_id`) **INCLUDE** (`marks`, `difficulty`) | Covering lookup for variant generation — fetches a round's pool with marks/difficulty without a heap visit. |
| `question_papers_round_uniq` | `question_papers` | **unique** btree (`round_id`) | Enforces one paper per round. |
| `exam_sittings_active_uniq` | `exam_sittings` | **unique, partial** btree (`student_membership_id`, `question_paper_id`) **WHERE** `status = 'active'` | Guarantees a student holds at most one active sitting per paper (resume-safe concurrency). |
| `submissions_student_round_idx` | `submissions` | btree (`student_membership_id`, `round_id`) | Fast per-student, per-round submission lookups. |

:::note Documented divergence from the Drizzle snapshot
Drizzle's index builder **cannot express an `INCLUDE` clause**. The covering columns on `questions_round_idx` (`marks`, `difficulty`) are therefore written **by hand** in the migration SQL, while `meta/0013_snapshot.json` records only the plain `round_id` index. This is an intentional, documented divergence — if the covering set ever changes, keep the hand-written SQL and the snapshot in sync manually.
:::

## Deployment & Security

The database is deployed on **Supabase**, a fully managed backend-as-a-service built on top of enterprise-grade PostgreSQL.

- **Connection Management**: We utilize Supabase's built-in connection pooler (PgBouncer) via a Transaction-mode connection string. This is critical for Next.js API routes and Server Actions to prevent connection exhaustion in serverless environments.
- **Migrations**: Schema changes are version-controlled through numbered SQL migration files committed to the tracked **`drizzle/`** folder (with matching `drizzle/meta/*_snapshot.json` files). We generate a migration from the Drizzle schema with **`npm run db:generate`** (`drizzle-kit generate`) and apply it deterministically with **`npm run db:migrate`** (`drizzle-kit migrate`) against the Supabase instance.
  - **`0013_question_bank_variants`** is **purely additive** and non-destructive: it adds **6 nullable columns** (`rounds.targetTotalMarks`, `question_papers.selectedQuestionIds`, `questions.difficulty`, `exam_sittings.variantQuestionIds`, `exam_sittings.variantSeed`, `submissions.variantQuestionIds`), relaxes `questions.marks` with `DROP NOT NULL` (preserving every existing value), and creates **4 indexes** (see above). There are no renames, no column/table drops, and no data loss.
- **Authentication Sync**: We leverage Supabase Auth for identity management. When a user signs up, application logic securely maps the `auth.users.id` to our public `users.id` schema.
- **Security Authorization**: While Supabase offers Row Level Security (RLS), our architecture handles authorization *at the application layer* inside Next.js Server Actions using the `memberships` table. This allows us to implement highly complex, business-specific role checks (e.g., "Is this user an educator at a school that is approved for this specific portal?") before executing database queries via Drizzle.

## Structural Motivation: Drizzle ORM vs Prisma vs NoSQL

We deliberately selected a strictly relational PostgreSQL database via **Drizzle ORM**, actively rejecting both NoSQL solutions and the Prisma ORM for the following reasons:

1. **Relational Integrity Over NoSQL**: The educational domain has strict hierarchical requirements. An exam sitting must belong to a student, who must belong to a school, which must participate in a portal's round. Foreign keys and cascading deletes (`ON DELETE CASCADE`) in PostgreSQL ensure we never have orphaned records—a common risk in MongoDB.
2. **Drizzle ORM vs Prisma (Performance & Edge Compatibility)**: 
   - While Prisma provides an excellent developer experience, its underlying Rust engine is notoriously heavy and cold-starts slowly in serverless environments. 
   - Drizzle ORM is extremely lightweight, fully Edge-compatible, and executes queries significantly faster in Next.js Server Actions.
3. **SQL-Like Syntax**: Drizzle's query builder allows us to write TypeScript that closely mirrors standard SQL. This enables us to easily write the complex `JOIN`s and aggregation functions required for calculating global leaderboards and school statistics without battling obscure ORM syntax.
4. **End-to-End Type Safety**: Drizzle infers exact TypeScript types directly from our schema definitions, ensuring that if a database column changes, our React components immediately throw compile-time errors.
