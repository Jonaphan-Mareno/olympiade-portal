// The portal's "chasing" engine: it builds and sends the automated reminder
// emails that keep schools on schedule. The organiser's automation rules
// (src/domain/notifications/automation-rules.ts) decide *when* to notify and
// under which conditions; this module decides *who* to notify and *what*
// they receive:
//
//   round_opening_reminder        -> educators of every school in the portal
//   round_closing_reminder        -> educators (optionally only schools with
//                                    outstanding submissions)
//   submission_overdue_followup   -> educators of schools with missing submissions
//   results_published_school      -> educators (school-level summary)
//   results_published_entrant     -> each entrant who submitted (own result)
//
// Every trigger is split into a pure-ish plan step (who gets which email —
// also used by the organiser's dry run) and a dispatch step. Every send is
// logged in notification_log and deduplicated per (kind, round, recipient,
// rule) so the sweep can run hourly without double-sending, while failed
// sends are retried on the next run.

import { db } from '@/lib/db';
import {
  memberships,
  notificationLog,
  results as resultsTable,
  schools,
  submissions,
  users,
} from '@/lib/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { sendEmail } from '@/lib/email';
import {
  fillSubjectTemplate,
  resultsPublishedEntrantEmail,
  resultsPublishedSchoolEmail,
  roundClosingReminderEmail,
  roundOpeningReminderEmail,
  submissionOverdueFollowupEmail,
} from './email-templates';
import { getRoundTotalMarks } from '../rounds/score-percentage';
import type { Round } from '../rounds/round.types';

export type NotificationKind =
  | 'round_opening_reminder'
  | 'round_closing_reminder'
  | 'submission_overdue_followup'
  | 'results_published_school'
  | 'results_published_entrant';

export type DispatchSummary = {
  sent: number;
  skipped: number;
  failed: number;
};

/** Per-rule settings that shape who is emailed and what the email says. */
export type SendOptions = {
  // Automation rule the emails belong to; part of the dedupe key so two
  // rules on the same trigger (e.g. 3 days and 1 hour before closing) each
  // send once
  ruleId?: string | null;
  // Optional plain-text message appended to the general template
  note?: string | null;
  // Optional subject line; supports {{roundName}}, {{portalName}}, {{schoolName}}
  subjectTemplate?: string | null;
  // Closing reminders: only chase schools that still have entrants who have
  // not submitted
  missingSubmissionsOnly?: boolean;
  // Results published: also email each entrant their own result
  includeEntrants?: boolean;
};

export type PlannedEmail = {
  kind: NotificationKind;
  roundId: string;
  recipientMembershipId: string;
  recipientEmail: string;
  schoolId: string | null;
  schoolName: string | null;
  audience: 'school' | 'entrant';
  subject: string;
  html: string;
};

type EducatorRecipient = {
  membershipId: string;
  email: string;
  schoolId: string;
  schoolName: string;
};

type EntrantRow = {
  membershipId: string;
  email: string;
  schoolId: string | null;
  schoolName: string | null;
  name: string | null;
};

function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000').replace(
    /\/+$/,
    ''
  );
}

function educatorDashboardUrl(portalId: string): string {
  return `${baseUrl()}/educator?portalId=${portalId}`;
}

function studentResultsUrl(portalId: string): string {
  return `${baseUrl()}/results/${portalId}`;
}

function subjectFor(
  defaultSubject: string,
  round: Round,
  schoolName: string | null,
  opts: SendOptions
): string {
  const template = opts.subjectTemplate?.trim();
  if (!template) return defaultSubject;
  return fillSubjectTemplate(template, {
    roundName: round.name,
    portalName: round.portalName,
    schoolName,
  });
}

/**
 * Send one email and record it in notification_log. Returns:
 * - 'skipped' when this recipient already got this email for this round and
 *   rule (idempotency for the scheduler sweep)
 * - 'sent' when the email went out
 * - 'failed' when delivery threw; the log row stays status='failed' so the
 *   next sweep retries it
 */
async function dispatch(
  email: PlannedEmail,
  ruleId: string | null
): Promise<'sent' | 'skipped' | 'failed'> {
  const logKey = and(
    eq(notificationLog.kind, email.kind),
    eq(notificationLog.roundId, email.roundId),
    eq(notificationLog.recipientMembershipId, email.recipientMembershipId),
    ruleId ? eq(notificationLog.ruleId, ruleId) : isNull(notificationLog.ruleId)
  );

  const [existing] = await db.select().from(notificationLog).where(logKey);

  if (existing?.status === 'sent') {
    return 'skipped';
  }

  if (!existing) {
    await db
      .insert(notificationLog)
      .values({
        kind: email.kind,
        roundId: email.roundId,
        ruleId,
        recipientMembershipId: email.recipientMembershipId,
        recipientEmail: email.recipientEmail,
        schoolId: email.schoolId,
        status: 'failed', // pessimistically recorded until the send succeeds
      })
      .onConflictDoNothing();
  }

  try {
    await sendEmail({
      to: email.recipientEmail,
      subject: email.subject,
      html: email.html,
    });
    await db
      .update(notificationLog)
      .set({
        status: 'sent',
        sentAt: new Date(),
        recipientEmail: email.recipientEmail,
      })
      .where(logKey);
    return 'sent';
  } catch (err) {
    console.error(
      `Failed to send ${email.kind} email to ${email.recipientEmail}:`,
      err
    );
    await db
      .update(notificationLog)
      .set({ status: 'failed', recipientEmail: email.recipientEmail })
      .where(logKey);
    return 'failed';
  }
}

/** Sends every planned email (sequentially) and tallies the outcomes. */
export async function dispatchPlanned(
  emails: PlannedEmail[],
  ruleId: string | null = null
): Promise<DispatchSummary> {
  const summary: DispatchSummary = { sent: 0, skipped: 0, failed: 0 };
  for (const email of emails) {
    summary[await dispatch(email, ruleId)]++;
  }
  return summary;
}

/**
 * Membership ids that already received a rule's email for a round — the
 * dry run uses it to show who the next sweep would skip.
 */
export async function getAlreadySentRecipients(
  roundId: string,
  ruleId: string
): Promise<Set<string>> {
  const rows = await db
    .select({
      recipientMembershipId: notificationLog.recipientMembershipId,
      status: notificationLog.status,
    })
    .from(notificationLog)
    .where(
      and(eq(notificationLog.roundId, roundId), eq(notificationLog.ruleId, ruleId))
    );
  return new Set(
    rows.filter((r) => r.status === 'sent').map((r) => r.recipientMembershipId)
  );
}

/**
 * All accepted educators across the portal's schools. Uses the linked user's
 * address when the membership is claimed, otherwise the invited email.
 */
export async function getEducatorsForPortal(
  portalId: string
): Promise<EducatorRecipient[]> {
  const rows = await db
    .select({
      membershipId: memberships.id,
      invitedEmail: memberships.invitedEmail,
      userEmail: users.email,
      schoolId: memberships.schoolId,
      schoolName: schools.name,
    })
    .from(memberships)
    .innerJoin(schools, eq(schools.id, memberships.schoolId))
    .leftJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.portalId, portalId),
        eq(memberships.role, 'educator'),
        eq(memberships.status, 'accepted')
      )
    );

  return rows
    .filter((r) => r.schoolId !== null)
    .map((r) => ({
      membershipId: r.membershipId,
      email: r.userEmail ?? r.invitedEmail,
      schoolId: r.schoolId as string,
      schoolName: r.schoolName,
    }));
}

/**
 * Accepted entrants of the portal together with the ids of those who have a
 * submitted submission for the round. Powers both the closing reminder's
 * progress line and the overdue follow-up.
 */
export async function getEntrantSubmissionStatus(
  portalId: string,
  roundId: string
): Promise<{
  entrants: EntrantRow[];
  submittedMembershipIds: Set<string>;
}> {
  const entrants = await db
    .select({
      membershipId: memberships.id,
      invitedEmail: memberships.invitedEmail,
      userEmail: users.email,
      schoolId: memberships.schoolId,
      schoolName: schools.name,
      name: users.name,
    })
    .from(memberships)
    .leftJoin(schools, eq(schools.id, memberships.schoolId))
    .leftJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.portalId, portalId),
        eq(memberships.role, 'student'),
        eq(memberships.status, 'accepted')
      )
    );

  const submitted = await db
    .select({ studentMembershipId: submissions.studentMembershipId })
    .from(submissions)
    .where(
      and(eq(submissions.roundId, roundId), eq(submissions.status, 'submitted'))
    );

  return {
    entrants: entrants.map((e) => ({
      membershipId: e.membershipId,
      email: e.userEmail ?? e.invitedEmail,
      schoolId: e.schoolId,
      schoolName: e.schoolName,
      name: e.name,
    })),
    submittedMembershipIds: new Set(
      submitted
        .map((s) => s.studentMembershipId)
        .filter((id): id is string => id !== null)
    ),
  };
}

type SchoolStats = {
  entrantCount: number;
  submittedCount: number;
  missingNames: string[];
};

function statsBySchool(
  entrants: EntrantRow[],
  submittedMembershipIds: Set<string>
): Map<string, SchoolStats> {
  const stats = new Map<string, SchoolStats>();
  for (const entrant of entrants) {
    if (!entrant.schoolId) continue;
    const s = stats.get(entrant.schoolId) ?? {
      entrantCount: 0,
      submittedCount: 0,
      missingNames: [],
    };
    s.entrantCount++;
    if (submittedMembershipIds.has(entrant.membershipId)) {
      s.submittedCount++;
    } else {
      s.missingNames.push(entrant.name ?? entrant.email);
    }
    stats.set(entrant.schoolId, s);
  }
  return stats;
}

/** Educators-only: the round is about to open. */
export async function planRoundOpeningReminders(
  round: Round,
  opts: SendOptions = {}
): Promise<PlannedEmail[]> {
  const educators = await getEducatorsForPortal(round.portalId);
  const dashboardUrl = educatorDashboardUrl(round.portalId);

  return educators.map((educator) => {
    const { subject, html } = roundOpeningReminderEmail({
      roundName: round.name,
      portalName: round.portalName,
      schoolName: educator.schoolName,
      opensAt: round.opensAt,
      closesAt: round.closesAt,
      deliveryMethod: round.deliveryMethod,
      dashboardUrl,
      note: opts.note,
    });
    return {
      kind: 'round_opening_reminder' as const,
      roundId: round.id,
      recipientMembershipId: educator.membershipId,
      recipientEmail: educator.email,
      schoolId: educator.schoolId,
      schoolName: educator.schoolName,
      audience: 'school' as const,
      subject: subjectFor(subject, round, educator.schoolName, opts),
      html,
    };
  });
}

/** Educators-only: the round is about to close, with per-school progress. */
export async function planRoundClosingReminders(
  round: Round,
  now: Date = new Date(),
  opts: SendOptions = {}
): Promise<PlannedEmail[]> {
  const educators = await getEducatorsForPortal(round.portalId);
  const { entrants, submittedMembershipIds } = await getEntrantSubmissionStatus(
    round.portalId,
    round.id
  );
  const dashboardUrl = educatorDashboardUrl(round.portalId);
  const stats = statsBySchool(entrants, submittedMembershipIds);

  // Exact remaining time (clamped at zero) so the email copy can say
  // "closes in about 1 hour" when the reminder is sent shortly before the
  // deadline instead of a misleading "closes in 0 days".
  const msLeft = Math.max(round.closesAt.getTime() - now.getTime(), 0);
  const daysLeft = Math.floor(msLeft / (24 * 60 * 60 * 1000));
  const hoursLeft = Math.floor(msLeft / (60 * 60 * 1000)) % 24;

  const planned: PlannedEmail[] = [];
  for (const educator of educators) {
    const school = stats.get(educator.schoolId) ?? {
      entrantCount: 0,
      submittedCount: 0,
      missingNames: [],
    };
    if (
      opts.missingSubmissionsOnly &&
      school.submittedCount >= school.entrantCount
    ) {
      continue;
    }
    const { subject, html } = roundClosingReminderEmail({
      roundName: round.name,
      portalName: round.portalName,
      schoolName: educator.schoolName,
      closesAt: round.closesAt,
      daysLeft,
      hoursLeft,
      submittedCount: school.submittedCount,
      entrantCount: school.entrantCount,
      dashboardUrl,
      note: opts.note,
    });
    planned.push({
      kind: 'round_closing_reminder',
      roundId: round.id,
      recipientMembershipId: educator.membershipId,
      recipientEmail: educator.email,
      schoolId: educator.schoolId,
      schoolName: educator.schoolName,
      audience: 'school',
      subject: subjectFor(subject, round, educator.schoolName, opts),
      html,
    });
  }
  return planned;
}

/**
 * Educators-only: the round has closed but their school's submissions have
 * not all arrived. Only schools with missing submissions are chased.
 */
export async function planSubmissionOverdueFollowups(
  round: Round,
  opts: SendOptions = {}
): Promise<PlannedEmail[]> {
  const educators = await getEducatorsForPortal(round.portalId);
  const { entrants, submittedMembershipIds } = await getEntrantSubmissionStatus(
    round.portalId,
    round.id
  );
  const dashboardUrl = educatorDashboardUrl(round.portalId);
  const stats = statsBySchool(entrants, submittedMembershipIds);

  const planned: PlannedEmail[] = [];
  for (const educator of educators) {
    const school = stats.get(educator.schoolId);
    if (!school || school.missingNames.length === 0) continue;

    const { subject, html } = submissionOverdueFollowupEmail({
      roundName: round.name,
      portalName: round.portalName,
      schoolName: educator.schoolName,
      closesAt: round.closesAt,
      missingCount: school.missingNames.length,
      missingEntrantNames: school.missingNames,
      dashboardUrl,
      note: opts.note,
    });
    planned.push({
      kind: 'submission_overdue_followup',
      roundId: round.id,
      recipientMembershipId: educator.membershipId,
      recipientEmail: educator.email,
      schoolId: educator.schoolId,
      schoolName: educator.schoolName,
      audience: 'school',
      subject: subjectFor(subject, round, educator.schoolName, opts),
      html,
    });
  }
  return planned;
}

/**
 * Educators get a school-level summary; unless the rule turns it off,
 * entrants who submitted also get their own result.
 */
export async function planResultsPublishedNotifications(
  round: Round,
  opts: SendOptions = {}
): Promise<PlannedEmail[]> {
  const educators = await getEducatorsForPortal(round.portalId);
  const { entrants, submittedMembershipIds } = await getEntrantSubmissionStatus(
    round.portalId,
    round.id
  );
  const resultsUrl = studentResultsUrl(round.portalId);
  const stats = statsBySchool(entrants, submittedMembershipIds);
  const planned: PlannedEmail[] = [];

  // --- Educators: school-level summary ---
  for (const educator of educators) {
    const school = stats.get(educator.schoolId);
    if (!school || school.entrantCount === 0) continue;

    const { subject, html } = resultsPublishedSchoolEmail({
      roundName: round.name,
      portalName: round.portalName,
      schoolName: educator.schoolName,
      entrantCount: school.entrantCount,
      submittedCount: school.submittedCount,
      resultsUrl,
      note: opts.note,
    });
    planned.push({
      kind: 'results_published_school',
      roundId: round.id,
      recipientMembershipId: educator.membershipId,
      recipientEmail: educator.email,
      schoolId: educator.schoolId,
      schoolName: educator.schoolName,
      audience: 'school',
      subject: subjectFor(subject, round, educator.schoolName, opts),
      html,
    });
  }

  if (opts.includeEntrants === false) return planned;

  // --- Entrants: their own result ---
  const submittedEntrants = entrants.filter((e) =>
    submittedMembershipIds.has(e.membershipId)
  );
  if (submittedEntrants.length === 0) return planned;

  const resultRows = await db
    .select({
      submissionId: submissions.id,
      studentMembershipId: submissions.studentMembershipId,
      score: resultsTable.score,
      feedback: resultsTable.feedback,
    })
    .from(submissions)
    .leftJoin(resultsTable, eq(resultsTable.submissionId, submissions.id))
    .where(
      and(
        eq(submissions.roundId, round.id),
        eq(submissions.status, 'submitted')
      )
    );
  const totalMarks = (await getRoundTotalMarks([round.id])).get(round.id);

  const resultByMembership = new Map<
    string,
    { score: string | null; feedback: string | null }
  >();
  for (const row of resultRows) {
    if (row.studentMembershipId) {
      resultByMembership.set(row.studentMembershipId, {
        score: row.score,
        feedback: row.feedback,
      });
    }
  }

  for (const entrant of submittedEntrants) {
    const result = resultByMembership.get(entrant.membershipId);
    const { subject, html } = resultsPublishedEntrantEmail({
      roundName: round.name,
      portalName: round.portalName,
      entrantName: entrant.name,
      score: result?.score ?? null,
      feedback: result?.feedback ?? null,
      qualifyingThreshold: round.qualifyingThreshold,
      totalMarks,
      resultsUrl,
      note: opts.note,
    });
    planned.push({
      kind: 'results_published_entrant',
      roundId: round.id,
      recipientMembershipId: entrant.membershipId,
      recipientEmail: entrant.email,
      schoolId: entrant.schoolId,
      schoolName: entrant.schoolName,
      audience: 'entrant',
      // The organiser's subject is written for schools; entrants keep the
      // personal default subject
      subject,
      html,
    });
  }

  return planned;
}

export async function sendRoundOpeningReminders(
  round: Round,
  opts: SendOptions = {}
): Promise<DispatchSummary> {
  return dispatchPlanned(
    await planRoundOpeningReminders(round, opts),
    opts.ruleId ?? null
  );
}

export async function sendRoundClosingReminders(
  round: Round,
  now: Date = new Date(),
  opts: SendOptions = {}
): Promise<DispatchSummary> {
  return dispatchPlanned(
    await planRoundClosingReminders(round, now, opts),
    opts.ruleId ?? null
  );
}

export async function sendSubmissionOverdueFollowups(
  round: Round,
  opts: SendOptions = {}
): Promise<DispatchSummary> {
  return dispatchPlanned(
    await planSubmissionOverdueFollowups(round, opts),
    opts.ruleId ?? null
  );
}

export async function sendResultsPublishedNotifications(
  round: Round,
  opts: SendOptions = {}
): Promise<DispatchSummary> {
  return dispatchPlanned(
    await planResultsPublishedNotifications(round, opts),
    opts.ruleId ?? null
  );
}
