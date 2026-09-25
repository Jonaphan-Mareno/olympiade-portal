import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  integer,
  numeric,
  jsonb,
  unique,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// We map the Supabase auth.users table so we can create foreign keys to it
// Note: We don't manage this table via Drizzle migrations (Supabase manages it),
// but we need it for relations.
import { pgSchema, type AnyPgColumn } from 'drizzle-orm/pg-core';
export const authSchema = pgSchema('auth');
export const authUsers = authSchema.table('users', {
  id: uuid('id').primaryKey(),
});

export const users = pgTable('users', {
  id: uuid('id')
    .primaryKey()
    .references((): AnyPgColumn => authUsers.id, { onDelete: 'cascade' }),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  isPlatformAdmin: boolean('is_platform_admin').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  schoolId: uuid('school_id').references((): AnyPgColumn => schools.id),
});

export const organiserApplications = pgTable('organiser_applications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .references((): AnyPgColumn => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  pdfUrl: text('pdf_url').notNull(),
  status: text('status', { enum: ['pending', 'approved', 'rejected'] })
    .default('pending')
    .notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const schools = pgTable('schools', {
  id: uuid('id').primaryKey().defaultRandom(),
  portalId: uuid('portal_id')
    .references((): AnyPgColumn => portals.id, { onDelete: 'cascade' })
    .notNull(),
  name: text('name').notNull(),
  type: text('type', { enum: ['high_school', 'university'] }),
  externalId: text('external_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const portals = pgTable('portals', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: uuid('owner_user_id').references((): AnyPgColumn => users.id, {
    onDelete: 'set null',
  }),
  name: text('name').notNull(),
  status: text('status', {
    enum: ['pending', 'approved', 'rejected'],
  }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }), // Nullable until account is claimed; removed with the user
    portalId: uuid('portal_id')
      .references(() => portals.id, { onDelete: 'cascade' })
      .notNull(),
    schoolId: uuid('school_id').references(() => schools.id), // Scoped to portal
    role: text('role', {
      enum: ['admin', 'organiser', 'educator', 'student', 'reviewer'],
    }).notNull(),
    status: text('status', {
      enum: ['invited', 'pending', 'accepted', 'rejected'],
    }).notNull(),
    invitedEmail: text('invited_email').notNull(),
    inviteToken: uuid('invite_token').defaultRandom(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
  },
  (t) => ({
    unq: unique().on(t.portalId, t.invitedEmail),
  })
);

export const rounds = pgTable('rounds', {
  id: uuid('id').primaryKey().defaultRandom(),
  portalId: uuid('portal_id')
    .references(() => portals.id, { onDelete: 'cascade' })
    .notNull(),
  name: text('name').notNull(),
  orderIndex: integer('order_index').notNull(),
  deliveryMethod: text('delivery_method', { enum: ['online', 'paper', 'hybrid'] })
    .default('paper')
    .notNull(),
  opensAt: timestamp('opens_at', { withTimezone: true }).notNull(),
  closesAt: timestamp('closes_at', { withTimezone: true }).notNull(),
  // Minimum score (%) a student must achieve to advance to the next round.
  // Leave null to disable this filter.
  qualifyingThreshold: numeric('qualifying_threshold'),
  // Top-N advancement: if set, only the N highest-scoring students advance.
  // Can be combined with qualifyingThreshold (both conditions must be met).
  thresholdTopN: integer('threshold_top_n'),
  // drives the "results are out" emails to educators and entrants
  resultsPublishedAt: timestamp('results_published_at', { withTimezone: true }),
  certificateTemplateUrl: text('certificate_template_url'),
  nameXCoord: numeric('name_x_coord'),
  nameYCoord: numeric('name_y_coord'),
  nameFontSize: integer('name_font_size').default(48),
  nameTextColor: text('name_text_color').default('#000000'),
});

export const certificateTemplates = pgTable('certificate_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  roundId: uuid('round_id')
    .notNull()
    .references(() => rounds.id, { onDelete: 'cascade' }),
  minScorePercentage: numeric('min_score_percentage').notNull(),
  templateUrl: text('template_url').notNull(),
  nameXCoord: numeric('name_x_coord').notNull(),
  nameYCoord: numeric('name_y_coord').notNull(),
  nameFontSize: integer('name_font_size').default(48).notNull(),
  nameTextColor: text('name_text_color').default('#000000').notNull(),
});

export const questionPapers = pgTable('question_papers', {
  id: uuid('id').primaryKey().defaultRandom(),
  roundId: uuid('round_id')
    .references(() => rounds.id, { onDelete: 'cascade' })
    .notNull(),
  fileUrl: text('file_url'),
  isMultipleChoice: boolean('is_multiple_choice').default(false),
  answerKeyJson: jsonb('answer_key_json'),
  durationMinutes: integer('duration_minutes').default(60),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const submissions = pgTable('submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  roundId: uuid('round_id')
    .references(() => rounds.id, { onDelete: 'cascade' })
    .notNull(),
  studentMembershipId: uuid('student_membership_id').references(
    () => memberships.id
  ),
  submittedByMembershipId: uuid('submitted_by_membership_id').references(
    () => memberships.id
  ),
  submissionType: text('submission_type', { enum: ['online', 'offline'] }),
  fileUrl: text('file_url'),
  answersJson: jsonb('answers_json'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  status: text('status', { enum: ['draft', 'submitted'] }),
});

export const results = pgTable('results', {
  id: uuid('id').primaryKey().defaultRandom(),
  submissionId: uuid('submission_id')
    .references(() => submissions.id)
    .unique()
    .notNull(),
  gradedByMembershipId: uuid('graded_by_membership_id').references(
    () => memberships.id
  ),
  score: numeric('score'),
  feedback: text('feedback'),
  status: text('status', {
    enum: [
      'auto_marked',
      'queued_for_marker',
      'moderated',
      'remark_requested',
      'remark_resolved',
    ],
  }),
  remarkReason: text('remark_reason'),
  remarkOutcome: text('remark_outcome'),
});

export const examSittings = pgTable('exam_sittings', {
  id: uuid('id').primaryKey().defaultRandom(),
  studentMembershipId: uuid('student_membership_id')
    .references(() => memberships.id, { onDelete: 'cascade' })
    .notNull(),
  questionPaperId: uuid('question_paper_id')
    .references(() => questionPapers.id, { onDelete: 'cascade' })
    .notNull(),
  startedAt: timestamp('started_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  status: text('status', { enum: ['active', 'submitted', 'abandoned'] })
    .default('active')
    .notNull(),
});

export const questions = pgTable('questions', {
  id: uuid('id').primaryKey().defaultRandom(),
  roundId: uuid('round_id')
    .references(() => rounds.id, { onDelete: 'cascade' })
    .notNull(),
  questionType: text('question_type', {
    enum: [
      'single_choice',
      'multiple_choice',
      'true_false',
      'matching',
      'free_text',
    ],
  }).notNull(),
  prompt: text('prompt').notNull(),
  imageUrl: text('image_url'),
  options: jsonb('options'),
  correctAnswer: jsonb('correct_answer'),
  marks: integer('marks').notNull(),
});

export const studentAnswers = pgTable(
  'student_answers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sittingId: uuid('sitting_id')
      .references(() => examSittings.id, { onDelete: 'cascade' })
      .notNull(),
    questionId: uuid('question_id').references(() => questions.id, {
      onDelete: 'cascade',
    }),
    questionNumber: integer('question_number'),
    answerValue: text('answer_value').notNull(),
    manualScore: numeric('manual_score'),
    educatorFeedback: text('educator_feedback'),
    savedAt: timestamp('saved_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    unq: unique().on(t.sittingId, t.questionId),
  })
);

// Audit + idempotency log for the automated reminder emails sent by the
// notification engine (src/domain/notifications/automation-engine.ts).
// The unique (kind, round, recipient) constraint guarantees each recipient
// gets at most one email of each kind per round, so the scheduler sweep can
// run repeatedly (daily cron, manual triggers) without double-sending.
export const notificationLog = pgTable(
  'notification_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind', {
      enum: [
        // Round opens soon -> educators of every school in the portal
        'round_opening_reminder',
        // Round closes soon -> educators of every school in the portal
        'round_closing_reminder',
        // Round closed but a school's submissions never arrived -> educators
        'submission_overdue_followup',
        // Results released -> school-level summary for educators
        'results_published_school',
        // Results released -> own result for each entrant
        'results_published_entrant',
      ],
    }).notNull(),
    roundId: uuid('round_id')
      .references(() => rounds.id, { onDelete: 'cascade' })
      .notNull(),
    // Membership of the educator (school-level emails) or entrant
    // (individual result email) the notification was addressed to
    recipientMembershipId: uuid('recipient_membership_id')
      .references(() => memberships.id, { onDelete: 'cascade' })
      .notNull(),
    recipientEmail: text('recipient_email').notNull(),
    // Kept for context so reminders can be traced back to a school
    schoolId: uuid('school_id').references(() => schools.id, {
      onDelete: 'cascade',
    }),
    status: text('status', { enum: ['sent', 'failed'] })
      .default('sent')
      .notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    unq: unique('notification_log_kind_round_recipient_unique').on(
      t.kind,
      t.roundId,
      t.recipientMembershipId
    ),
  })
);

export const inAppNotifications = pgTable('in_app_notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  isRead: boolean('is_read').default(false).notNull(),
  linkUrl: text('link_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
