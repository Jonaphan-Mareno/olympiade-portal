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
| **`rounds`** | Distinct phases of a competition | `portalId` → `portals.id` | `name`, `deliveryMethod`, `opensAt` |
| **`question_papers`** | Contains the actual test material | `roundId` → `rounds.id` | `fileUrl`, `isMultipleChoice` |
| **`questions`** | Individual questions for online exams | `roundId` → `rounds.id` | `prompt`, `marks`, `questionType` |
| **`exam_sittings`** | Tracks live online exam sessions | `studentMembershipId` → `memberships.id`<br/>`questionPaperId` → `question_papers.id` | `startedAt`, `status` |
| **`submissions`** | Wraps offline/online answers for grading | `roundId` → `rounds.id`<br/>`studentMembershipId` → `memberships.id` | `submissionType`, `fileUrl` |
| **`results`** | Final graded scores | `submissionId` → `submissions.id` | `score`, `status`, `feedback` |

## Deployment & Security

The database is deployed on **Supabase**, a fully managed backend-as-a-service built on top of enterprise-grade PostgreSQL.

- **Connection Management**: We utilize Supabase's built-in connection pooler (PgBouncer) via a Transaction-mode connection string. This is critical for Next.js API routes and Server Actions to prevent connection exhaustion in serverless environments.
- **Migrations**: Migrations are generated and executed using `drizzle-kit push` and `drizzle-kit generate`, ensuring that schema changes are version-controlled and deterministically applied to the Supabase instance.
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
