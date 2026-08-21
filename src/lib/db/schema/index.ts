import { pgTable, uuid, text, boolean, timestamp, integer, numeric, jsonb, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// We map the Supabase auth.users table so we can create foreign keys to it
// Note: We don't manage this table via Drizzle migrations (Supabase manages it),
// but we need it for relations.
import { pgSchema } from "drizzle-orm/pg-core";
export const authSchema = pgSchema('auth');
export const authUsers = authSchema.table('users', {
  id: uuid('id').primaryKey(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().references(() => authUsers.id, { onDelete: 'cascade' }),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  isPlatformAdmin: boolean('is_platform_admin').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const organiserApplications = pgTable('organiser_applications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull().unique(),
  pdfUrl: text('pdf_url').notNull(),
  status: text('status', { enum: ['pending', 'approved', 'rejected'] }).default('pending').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});


export const schools = pgTable('schools', {
  id: uuid('id').primaryKey().defaultRandom(),
  portalId: uuid('portal_id').references(() => portals.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const portals = pgTable('portals', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: uuid('owner_user_id').references(() => users.id),
  name: text('name').notNull(),
  status: text('status', { enum: ['pending', 'approved', 'rejected'] }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const memberships = pgTable('memberships', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id), // Nullable until account is claimed
  portalId: uuid('portal_id').references(() => portals.id, { onDelete: 'cascade' }).notNull(),
  schoolId: uuid('school_id').references(() => schools.id), // Scoped to portal
  role: text('role', { enum: ['admin', 'organiser', 'educator', 'student', 'reviewer'] }).notNull(),
  status: text('status', { enum: ['invited', 'pending', 'accepted', 'rejected'] }).notNull(),
  invitedEmail: text('invited_email').notNull(),
  inviteToken: uuid('invite_token').defaultRandom(),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
}, (t) => ({
  unq: unique().on(t.portalId, t.invitedEmail)
}));

export const rounds = pgTable('rounds', {
  id: uuid('id').primaryKey().defaultRandom(),
  portalId: uuid('portal_id').references(() => portals.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  orderIndex: integer('order_index').notNull(),
  opensAt: timestamp('opens_at', { withTimezone: true }).notNull(),
  closesAt: timestamp('closes_at', { withTimezone: true }).notNull(),
  qualifyingThreshold: numeric('qualifying_threshold'),
});

export const questionPapers = pgTable('question_papers', {
  id: uuid('id').primaryKey().defaultRandom(),
  roundId: uuid('round_id').references(() => rounds.id, { onDelete: 'cascade' }).notNull(),
  fileUrl: text('file_url'),
  isMultipleChoice: boolean('is_multiple_choice').default(false),
  answerKeyJson: jsonb('answer_key_json'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const submissions = pgTable('submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  roundId: uuid('round_id').references(() => rounds.id, { onDelete: 'cascade' }).notNull(),
  studentMembershipId: uuid('student_membership_id').references(() => memberships.id),
  submittedByMembershipId: uuid('submitted_by_membership_id').references(() => memberships.id),
  submissionType: text('submission_type', { enum: ['online', 'offline'] }),
  fileUrl: text('file_url'),
  answersJson: jsonb('answers_json'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  status: text('status', { enum: ['draft', 'submitted'] }),
});

export const results = pgTable('results', {
  id: uuid('id').primaryKey().defaultRandom(),
  submissionId: uuid('submission_id').references(() => submissions.id).unique().notNull(),
  gradedByMembershipId: uuid('graded_by_membership_id').references(() => memberships.id),
  score: numeric('score'),
  feedback: text('feedback'),
  status: text('status', { enum: ['auto_marked', 'queued_for_marker', 'moderated', 'remark_requested'] }),
});
