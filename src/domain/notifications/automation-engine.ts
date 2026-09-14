// The portal's "chasing" engine: it sends the automated reminder emails that
// keep schools on schedule. The scheduler sweep (src/domain/rounds/round-scheduler.ts)
// and the publish-results Server Action decide *when* to notify; this module
// decides *who* to notify and *what* they receive:
//
//   round_opening_reminder        -> educators of every school in the portal
//   round_closing_reminder        -> educators of every school in the portal
//   submission_overdue_followup   -> educators of schools with missing submissions
//   results_published_school      -> educators (school-level summary)
//   results_published_entrant     -> each entrant who submitted (own result)
//
// Every send is logged in notification_log and deduplicated per
// (kind, round, recipient) so the sweep can run hourly without double-sending,
// while failed sends are retried on the next run.

import { db } from '@/lib/db';
import {
  memberships,
  notificationLog,
  results as resultsTable,
  schools,
  submissions,
  users,
} from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { sendEmail } from '@/lib/email';
import {
  resultsPublishedEntrantEmail,
  resultsPublishedSchoolEmail,
  roundClosingReminderEmail,
  roundOpeningReminderEmail,
  submissionOverdueFollowupEmail,
} from './email-templates';
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
  return `${baseUrl()}/educator/dashboard?portalId=${portalId}`;
}

function studentResultsUrl(portalId: string): string {
  return `${baseUrl()}/results/${portalId}`;
}

/**
 * Send one email and record it in notification_log. Returns:
 * - 'skipped' when this recipient already got this kind of email for this
 *   round (idempotency for the scheduler sweep)
 * - 'sent' when the email went out
 * - 'failed' when delivery threw; the log row stays status='failed' so the
 *   next sweep retries it
 */
async function dispatch(params: {
  kind: NotificationKind;
  roundId: string;
  recipientMembershipId: string;
  recipientEmail: string;
  schoolId: string | null;
  subject: string;
  html: string;
}): Promise<'sent' | 'skipped' | 'failed'> {
  const logKey = and(
    eq(notificationLog.kind, params.kind),
    eq(notificationLog.roundId, params.roundId),
    eq(notificationLog.recipientMembershipId, params.recipientMembershipId)
  );

  const [existing] = await db.select().from(notificationLog).where(logKey);

  if (existing?.status === 'sent') {
    return 'skipped';
  }

  if (!existing) {
    await db
      .insert(notificationLog)
      .values({
        kind: params.kind,
        roundId: params.roundId,
        recipientMembershipId: params.recipientMembershipId,
        recipientEmail: params.recipientEmail,
        schoolId: params.schoolId,
        status: 'failed', // pessimistically recorded until the send succeeds
      })
      .onConflictDoNothing();
  }

  try {
    await sendEmail({
      to: params.recipientEmail,
      subject: params.subject,
      html: params.html,
    });
    await db
      .update(notificationLog)
      .set({
        status: 'sent',
        sentAt: new Date(),
        recipientEmail: params.recipientEmail,
      })
      .where(logKey);
    return 'sent';
  } catch (err) {
    console.error(
      `Failed to send ${params.kind} email to ${params.recipientEmail}:`,
      err
    );
    await db
      .update(notificationLog)
      .set({ status: 'failed', recipientEmail: params.recipientEmail })
      .where(logKey);
    return 'failed';
  }
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

/** Educators-only: the round is about to open. */
export async function sendRoundOpeningReminders(
  round: Round
): Promise<DispatchSummary> {
  const educators = await getEducatorsForPortal(round.portalId);
  const summary: DispatchSummary = { sent: 0, skipped: 0, failed: 0 };
  const dashboardUrl = educatorDashboardUrl(round.portalId);

  for (const educator of educators) {
    const { subject, html } = roundOpeningReminderEmail({
      roundName: round.name,
      portalName: round.portalName,
      schoolName: educator.schoolName,
      opensAt: round.opensAt,
      closesAt: round.closesAt,
      deliveryMethod: round.deliveryMethod,
      dashboardUrl,
    });

    const outcome = await dispatch({
      kind: 'round_opening_reminder',
      roundId: round.id,
      recipientMembershipId: educator.membershipId,
      recipientEmail: educator.email,
      schoolId: educator.schoolId,
      subject,
      html,
    });
    summary[outcome]++;
  }

  return summary;
}

/** Educators-only: the round is about to close, with per-school progress. */
export async function sendRoundClosingReminders(
  round: Round,
  now: Date = new Date()
): Promise<DispatchSummary> {
  const educators = await getEducatorsForPortal(round.portalId);
  const { entrants, submittedMembershipIds } = await getEntrantSubmissionStatus(
    round.portalId,
    round.id
  );

  const summary: DispatchSummary = { sent: 0, skipped: 0, failed: 0 };
  const dashboardUrl = educatorDashboardUrl(round.portalId);

  // Exact remaining time (clamped at zero) so the email copy can say
  // "closes in about 1 hour" when the reminder is sent shortly before the
  // deadline instead of a misleading "closes in 0 days".
  const msLeft = Math.max(round.closesAt.getTime() - now.getTime(), 0);
  const daysLeft = Math.floor(msLeft / (24 * 60 * 60 * 1000));
  const hoursLeft = Math.floor(msLeft / (60 * 60 * 1000)) % 24;

  const statsBySchool = new Map<
    string,
    { entrantCount: number; submittedCount: number }
  >();
  for (const entrant of entrants) {
    if (!entrant.schoolId) continue;
    const stats = statsBySchool.get(entrant.schoolId) ?? {
      entrantCount: 0,
      submittedCount: 0,
    };
    stats.entrantCount++;
    if (submittedMembershipIds.has(entrant.membershipId)) {
      stats.submittedCount++;
    }
    statsBySchool.set(entrant.schoolId, stats);
  }

  for (const educator of educators) {
    const stats = statsBySchool.get(educator.schoolId) ?? {
      entrantCount: 0,
      submittedCount: 0,
    };
    const { subject, html } = roundClosingReminderEmail({
      roundName: round.name,
      portalName: round.portalName,
      schoolName: educator.schoolName,
      closesAt: round.closesAt,
      daysLeft,
      hoursLeft,
      submittedCount: stats.submittedCount,
      entrantCount: stats.entrantCount,
      dashboardUrl,
    });

    const outcome = await dispatch({
      kind: 'round_closing_reminder',
      roundId: round.id,
      recipientMembershipId: educator.membershipId,
      recipientEmail: educator.email,
      schoolId: educator.schoolId,
      subject,
      html,
    });
    summary[outcome]++;
  }

  return summary;
}

/**
 * Educators-only: the round has closed but their school's submissions have
 * not all arrived. Only schools with missing submissions are chased.
 */
export async function sendSubmissionOverdueFollowups(
  round: Round
): Promise<DispatchSummary> {
  const educators = await getEducatorsForPortal(round.portalId);
  const { entrants, submittedMembershipIds } = await getEntrantSubmissionStatus(
    round.portalId,
    round.id
  );

  const summary: DispatchSummary = { sent: 0, skipped: 0, failed: 0 };
  const dashboardUrl = educatorDashboardUrl(round.portalId);

  const missingBySchool = new Map<string, { count: number; names: string[] }>();
  for (const entrant of entrants) {
    if (!entrant.schoolId || submittedMembershipIds.has(entrant.membershipId)) {
      continue;
    }
    const missing = missingBySchool.get(entrant.schoolId) ?? {
      count: 0,
      names: [],
    };
    missing.count++;
    missing.names.push(entrant.name ?? entrant.email);
    missingBySchool.set(entrant.schoolId, missing);
  }

  for (const educator of educators) {
    const missing = missingBySchool.get(educator.schoolId);
    if (!missing || missing.count === 0) continue;

    const { subject, html } = submissionOverdueFollowupEmail({
      roundName: round.name,
      portalName: round.portalName,
      schoolName: educator.schoolName,
      closesAt: round.closesAt,
      missingCount: missing.count,
      missingEntrantNames: missing.names,
      dashboardUrl,
    });

    const outcome = await dispatch({
      kind: 'submission_overdue_followup',
      roundId: round.id,
      recipientMembershipId: educator.membershipId,
      recipientEmail: educator.email,
      schoolId: educator.schoolId,
      subject,
      html,
    });
    summary[outcome]++;
  }

  return summary;
}

/**
 * Both audiences: educators get a school-level summary, entrants who
 * submitted get their own result (they can sign in and view their grades).
 */
export async function sendResultsPublishedNotifications(
  round: Round
): Promise<DispatchSummary> {
  const educators = await getEducatorsForPortal(round.portalId);
  const { entrants, submittedMembershipIds } = await getEntrantSubmissionStatus(
    round.portalId,
    round.id
  );

  const summary: DispatchSummary = { sent: 0, skipped: 0, failed: 0 };
  const resultsUrl = studentResultsUrl(round.portalId);

  // --- Educators: school-level summary ---
  const statsBySchool = new Map<
    string,
    { entrantCount: number; submittedCount: number; schoolName: string }
  >();
  for (const entrant of entrants) {
    if (!entrant.schoolId) continue;
    const stats = statsBySchool.get(entrant.schoolId) ?? {
      entrantCount: 0,
      submittedCount: 0,
      schoolName: entrant.schoolName ?? 'your school',
    };
    stats.entrantCount++;
    if (submittedMembershipIds.has(entrant.membershipId)) {
      stats.submittedCount++;
    }
    statsBySchool.set(entrant.schoolId, stats);
  }

  for (const educator of educators) {
    const stats = statsBySchool.get(educator.schoolId);
    if (!stats || stats.entrantCount === 0) continue;

    const { subject, html } = resultsPublishedSchoolEmail({
      roundName: round.name,
      portalName: round.portalName,
      schoolName: educator.schoolName,
      entrantCount: stats.entrantCount,
      submittedCount: stats.submittedCount,
      resultsUrl,
    });

    const outcome = await dispatch({
      kind: 'results_published_school',
      roundId: round.id,
      recipientMembershipId: educator.membershipId,
      recipientEmail: educator.email,
      schoolId: educator.schoolId,
      subject,
      html,
    });
    summary[outcome]++;
  }

  // --- Entrants: their own result ---
  const submittedEntrants = entrants.filter((e) =>
    submittedMembershipIds.has(e.membershipId)
  );

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
      resultsUrl,
    });

    const outcome = await dispatch({
      kind: 'results_published_entrant',
      roundId: round.id,
      recipientMembershipId: entrant.membershipId,
      recipientEmail: entrant.email,
      schoolId: entrant.schoolId,
      subject,
      html,
    });
    summary[outcome]++;
  }

  return summary;
}
