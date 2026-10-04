// Remark (appeal) workflow.
//
//   1. An entrant appeals a published mark within REMARK_WINDOW_DAYS, giving
//      a reason. One appeal per submission.
//   2. It appears in the remark queue of the educators at the entrant's
//      school (and on the organiser's Remarks tab for the round).
//   3. The marker re-marks it:
//        - online rounds: question by question, starting from the current
//          marks (auto-marked or educator-marked)
//        - paper rounds: re-mark the physical script and enter the new total
//      and must explain the outcome.
//   4. The new total is written to results.score — the single source the
//      standings, rankings, certificates and next-round qualification read —
//      and the outcome is shown to the entrant.

import { db } from '@/lib/db';
import {
  examSittings,
  inAppNotifications,
  memberships,
  portals,
  questionPapers,
  questions,
  remarkRequests,
  results,
  rounds,
  studentAnswers,
  submissions,
} from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { calculateEarnedMarks } from '../marking/auto-mark';
import { advanceQualifyingEntrants } from '../rounds/advance-entrants';
import { notifyEducatorsInPortal } from '../notifications/in-app-notifications';

export const REMARK_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type RemarkEligibility =
  | { eligible: true; closesAt: Date }
  | { eligible: false; reason: string };

/** Whether an entrant may appeal now. Pure, so the UI and server agree. */
export function getRemarkEligibility(
  params: {
    resultsPublishedAt: Date | null;
    hasScore: boolean;
    hasExistingRequest: boolean;
  },
  now: Date = new Date()
): RemarkEligibility {
  if (params.hasExistingRequest) {
    return { eligible: false, reason: 'A remark has already been requested for this paper.' };
  }
  if (!params.resultsPublishedAt) {
    return { eligible: false, reason: 'You can appeal once results are published.' };
  }
  if (!params.hasScore) {
    return { eligible: false, reason: 'This paper has not been marked yet.' };
  }
  const closesAt = new Date(params.resultsPublishedAt.getTime() + REMARK_WINDOW_DAYS * DAY_MS);
  if (now > closesAt) {
    return { eligible: false, reason: `Appeals closed ${REMARK_WINDOW_DAYS} days after results were published.` };
  }
  return { eligible: true, closesAt };
}

export type QuestionMark = {
  questionId: string;
  number: number;
  prompt: string;
  questionType: string;
  maxMarks: number;
  marks: number;
  studentAnswer: string;
  correctAnswer: string;
};

function displayAnswer(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') {
    try {
      return displayAnswer(JSON.parse(value));
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (obj.text !== undefined) return displayAnswer(obj.text);
    if (obj.memo !== undefined) return displayAnswer(obj.memo);
    return Object.values(obj).map(String).join(', ');
  }
  return String(value);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The current mark for each question of an online submission: a resolved
 * remark's marks win, then educator marks for free-text, then the
 * auto-marker.
 */
export async function getQuestionMarks(
  submissionId: string
): Promise<QuestionMark[]> {
  const [sub] = await db
    .select({
      roundId: submissions.roundId,
      studentMembershipId: submissions.studentMembershipId,
      answersJson: submissions.answersJson,
    })
    .from(submissions)
    .where(eq(submissions.id, submissionId));
  if (!sub) return [];

  const [roundQuestions, [remark], manualRows] = await Promise.all([
    db.select().from(questions).where(eq(questions.roundId, sub.roundId)),
    db
      .select({ status: remarkRequests.status, questionMarks: remarkRequests.questionMarks })
      .from(remarkRequests)
      .where(eq(remarkRequests.submissionId, submissionId)),
    sub.studentMembershipId
      ? db
          .select({ questionId: studentAnswers.questionId, manualScore: studentAnswers.manualScore })
          .from(studentAnswers)
          .innerJoin(examSittings, eq(examSittings.id, studentAnswers.sittingId))
          .innerJoin(questionPapers, eq(questionPapers.id, examSittings.questionPaperId))
          .where(
            and(
              eq(examSittings.studentMembershipId, sub.studentMembershipId),
              eq(questionPapers.roundId, sub.roundId)
            )
          )
      : Promise.resolve([]),
  ]);

  const answers = (sub.answersJson ?? {}) as Record<string, string>;
  const manualBy = new Map(
    manualRows.map((r) => [r.questionId, Number(r.manualScore ?? 0)])
  );
  const remarked =
    remark?.status === 'resolved' && remark.questionMarks
      ? (remark.questionMarks as Record<string, number>)
      : null;

  // Questions have no explicit order column; keep insertion order stable
  return roundQuestions.map((q, i) => {
    const maxMarks = q.marks ?? 1;
    let marks: number;
    if (remarked && remarked[q.id] !== undefined) {
      marks = Number(remarked[q.id]);
    } else if (q.questionType === 'free_text') {
      marks = manualBy.get(q.id) ?? 0;
    } else {
      marks = calculateEarnedMarks(q, answers[q.id]);
    }
    return {
      questionId: q.id,
      number: i + 1,
      prompt: q.prompt,
      questionType: q.questionType,
      maxMarks,
      marks: round2(marks),
      studentAnswer: displayAnswer(answers[q.id]),
      correctAnswer:
        q.questionType === 'free_text' ? 'Educator-marked' : displayAnswer(q.correctAnswer),
    };
  });
}

export type RemarkRow = {
  id: string;
  submissionId: string;
  reason: string;
  status: 'pending' | 'resolved';
  previousScore: string | null;
  newScore: string | null;
  responseNote: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  roundId: string;
  roundName: string;
  portalId: string;
  submissionType: 'online' | 'offline' | null;
  fileUrl: string | null;
  studentMembershipId: string | null;
  studentSchoolId: string | null;
  currentScore: string | null;
};

/** A remark request with the context needed to review it. */
export async function getRemarkRequest(requestId: string): Promise<RemarkRow | null> {
  const [row] = await db
    .select({
      id: remarkRequests.id,
      submissionId: remarkRequests.submissionId,
      reason: remarkRequests.reason,
      status: remarkRequests.status,
      previousScore: remarkRequests.previousScore,
      newScore: remarkRequests.newScore,
      responseNote: remarkRequests.responseNote,
      createdAt: remarkRequests.createdAt,
      resolvedAt: remarkRequests.resolvedAt,
      roundId: rounds.id,
      roundName: rounds.name,
      portalId: rounds.portalId,
      submissionType: submissions.submissionType,
      fileUrl: submissions.fileUrl,
      studentMembershipId: submissions.studentMembershipId,
      studentSchoolId: memberships.schoolId,
      currentScore: results.score,
    })
    .from(remarkRequests)
    .innerJoin(submissions, eq(submissions.id, remarkRequests.submissionId))
    .innerJoin(rounds, eq(rounds.id, submissions.roundId))
    .leftJoin(memberships, eq(memberships.id, submissions.studentMembershipId))
    .leftJoin(results, eq(results.submissionId, submissions.id))
    .where(eq(remarkRequests.id, requestId));
  return row ?? null;
}

/**
 * Who may re-mark: an accepted educator of the entrant's school in that
 * olympiad, or the olympiad's organiser.
 */
export async function canResolveRemark(
  userId: string,
  request: Pick<RemarkRow, 'portalId' | 'studentSchoolId'>
): Promise<boolean> {
  const [portal] = await db
    .select({ ownerUserId: portals.ownerUserId })
    .from(portals)
    .where(eq(portals.id, request.portalId));
  if (portal?.ownerUserId === userId) return true;
  if (!request.studentSchoolId) return false;

  const [educator] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.portalId, request.portalId),
        eq(memberships.schoolId, request.studentSchoolId),
        eq(memberships.role, 'educator'),
        eq(memberships.status, 'accepted')
      )
    );
  return Boolean(educator);
}

/** Entrant appeals their own submission. */
export async function createRemarkRequest(
  userId: string,
  submissionId: string,
  reason: string,
  now: Date = new Date()
): Promise<{ error?: string }> {
  const trimmed = reason.trim();
  if (!trimmed) return { error: 'Please explain which questions should be reviewed and why.' };
  if (trimmed.length > 2000) return { error: 'Please keep the reason under 2000 characters.' };

  const [row] = await db
    .select({
      score: results.score,
      resultsPublishedAt: rounds.resultsPublishedAt,
      portalId: rounds.portalId,
      roundName: rounds.name,
      schoolId: memberships.schoolId,
      existingId: remarkRequests.id,
    })
    .from(submissions)
    .innerJoin(memberships, eq(memberships.id, submissions.studentMembershipId))
    .innerJoin(rounds, eq(rounds.id, submissions.roundId))
    .leftJoin(results, eq(results.submissionId, submissions.id))
    .leftJoin(remarkRequests, eq(remarkRequests.submissionId, submissions.id))
    .where(and(eq(submissions.id, submissionId), eq(memberships.userId, userId)));

  if (!row) return { error: 'You can only appeal your own papers.' };

  const eligibility = getRemarkEligibility(
    {
      resultsPublishedAt: row.resultsPublishedAt,
      hasScore: row.score !== null,
      hasExistingRequest: row.existingId !== null,
    },
    now
  );
  if (!eligibility.eligible) return { error: eligibility.reason };

  const inserted = await db
    .insert(remarkRequests)
    .values({
      submissionId,
      requestedByUserId: userId,
      reason: trimmed,
      previousScore: row.score,
    })
    .onConflictDoNothing()
    .returning({ id: remarkRequests.id });
  if (inserted.length === 0) {
    return { error: 'A remark has already been requested for this paper.' };
  }

  // Kept in sync for screens that read the summary off the result row
  await db
    .update(results)
    .set({ status: 'remark_requested', remarkReason: trimmed })
    .where(eq(results.submissionId, submissionId));

  try {
    await notifySchoolEducators(
      row.portalId,
      row.schoolId,
      'Remark requested',
      `An entrant has appealed their mark for ${row.roundName}.`,
      `/educator/remarks/${inserted[0].id}`
    );
  } catch (err) {
    console.error('Failed to notify educators of remark request:', err);
  }
  return {};
}

async function notifySchoolEducators(
  portalId: string,
  schoolId: string | null,
  title: string,
  message: string,
  linkUrl: string
) {
  if (!schoolId) {
    await notifyEducatorsInPortal(portalId, title, message, linkUrl);
    return;
  }
  const educators = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.portalId, portalId),
        eq(memberships.schoolId, schoolId),
        eq(memberships.role, 'educator'),
        eq(memberships.status, 'accepted')
      )
    );
  const rows = educators
    .filter((e) => e.userId !== null)
    .map((e) => ({ userId: e.userId!, title, message, linkUrl }));
  if (rows.length > 0) await db.insert(inAppNotifications).values(rows);
}

export type ResolveInput = {
  requestId: string;
  note: string;
  // Online: new mark per question. Paper: the new total.
  questionMarks?: Record<string, number>;
  newTotal?: number;
};

/**
 * Applies a remark. Validates every mark against the question's maximum,
 * writes the new total to results.score, re-runs next-round qualification
 * for published rounds and notifies the entrant.
 */
export async function resolveRemarkRequest(
  userId: string,
  input: ResolveInput
): Promise<{ error?: string; newScore?: number }> {
  const request = await getRemarkRequest(input.requestId);
  if (!request) return { error: 'Remark request not found.' };
  if (request.status === 'resolved') return { error: 'This remark has already been resolved.' };
  if (!(await canResolveRemark(userId, request))) {
    return { error: 'You are not allowed to remark this paper.' };
  }

  const note = input.note.trim();
  if (!note) return { error: 'Explain the outcome to the entrant.' };

  let newScore: number;
  let questionMarks: Record<string, number> | null = null;

  if (request.submissionType === 'online') {
    const current = await getQuestionMarks(request.submissionId);
    if (current.length === 0) return { error: 'This paper has no questions to remark.' };
    questionMarks = {};
    for (const q of current) {
      const raw = input.questionMarks?.[q.questionId];
      const marks = raw === undefined ? q.marks : Number(raw);
      if (!Number.isFinite(marks) || marks < 0 || marks > q.maxMarks) {
        return { error: `Question ${q.number} must be between 0 and ${q.maxMarks} marks.` };
      }
      questionMarks[q.questionId] = round2(marks);
    }
    newScore = round2(Object.values(questionMarks).reduce((a, b) => a + b, 0));
  } else {
    const total = Number(input.newTotal);
    if (!Number.isFinite(total) || total < 0) {
      return { error: 'Enter the remarked total as zero or a positive number.' };
    }
    newScore = round2(total);
  }

  const previous = request.currentScore !== null ? Number(request.currentScore) : null;
  const outcome =
    previous === null || previous === newScore
      ? `Mark confirmed at ${newScore}. ${note}`
      : `Mark changed from ${previous} to ${newScore}. ${note}`;

  const updated = await db
    .update(remarkRequests)
    .set({
      status: 'resolved',
      newScore: String(newScore),
      questionMarks,
      responseNote: note,
      resolvedByUserId: userId,
      resolvedAt: new Date(),
    })
    .where(and(eq(remarkRequests.id, request.id), eq(remarkRequests.status, 'pending')))
    .returning({ id: remarkRequests.id });
  if (updated.length === 0) return { error: 'This remark has already been resolved.' };

  await db
    .update(results)
    .set({ score: String(newScore), status: 'remark_resolved', remarkOutcome: outcome })
    .where(eq(results.submissionId, request.submissionId));

  // A higher mark may now clear the next round's threshold. Advancement only
  // ever adds qualifications, so a lowered mark never removes a place.
  try {
    const [round] = await db
      .select({ resultsPublishedAt: rounds.resultsPublishedAt })
      .from(rounds)
      .where(eq(rounds.id, request.roundId));
    if (round?.resultsPublishedAt) await advanceQualifyingEntrants(request.roundId);
  } catch (err) {
    console.error('Failed to re-run advancement after remark:', err);
  }

  // The entrant sees the outcome on their notifications page, which reads
  // results.remarkOutcome (set above).

  return { newScore };
}
