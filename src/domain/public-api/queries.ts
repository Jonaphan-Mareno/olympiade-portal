import { and, asc, desc, eq, isNotNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  portals,
  questionPapers,
  questions,
  results,
  rounds,
  schools,
  submissions,
} from '@/lib/db/schema';

// Read queries backing the public API (src/app/api/public/*). The returned
// shapes are the public JSON contract: snake_case keys mirroring the columns,
// Dates that NextResponse.json serializes to ISO strings, and numeric columns
// converted from the strings Drizzle returns back to numbers.

export type PublicSchool = {
  name: string;
  external_id: string | null;
};

// The flat school list: every school any portal has registered, deduplicated
// across portals so the same school is not repeated for each olympiad.
export async function listPublicSchools(): Promise<PublicSchool[]> {
  const rows = await db
    .selectDistinct({ name: schools.name, externalId: schools.externalId })
    .from(schools)
    .orderBy(asc(schools.name));

  return rows.map((row) => ({ name: row.name, external_id: row.externalId }));
}

export type PublicPortal = {
  id: string;
  name: string;
  created_at: Date | null;
  status: 'pending' | 'approved' | 'rejected';
  schools: PublicSchool[];
};

// All portals with their schools; the consuming web app filters by status.
export async function listPublicPortals(): Promise<PublicPortal[]> {
  const [portalRows, schoolRows] = await Promise.all([
    db
      .select({
        id: portals.id,
        name: portals.name,
        createdAt: portals.createdAt,
        status: portals.status,
      })
      .from(portals)
      .orderBy(asc(portals.name)),
    db
      .select({
        portalId: schools.portalId,
        name: schools.name,
        externalId: schools.externalId,
      })
      .from(schools)
      .orderBy(asc(schools.name)),
  ]);

  const schoolsByPortal = new Map<string, PublicSchool[]>();
  for (const school of schoolRows) {
    const list = schoolsByPortal.get(school.portalId) ?? [];
    list.push({ name: school.name, external_id: school.externalId });
    schoolsByPortal.set(school.portalId, list);
  }

  return portalRows.map((portal) => ({
    id: portal.id,
    name: portal.name,
    created_at: portal.createdAt,
    status: portal.status,
    schools: schoolsByPortal.get(portal.id) ?? [],
  }));
}

export type PublicRound = {
  id: string;
  name: string;
  qualifying_threshold: number | null;
  opens_at: Date;
  closes_at: Date;
  portal: { id: string; name: string };
};

// Every round of every portal, in portal order then round order within the
// portal (order_index is the organiser-defined sequence).
export async function listPublicRounds(): Promise<PublicRound[]> {
  const rows = await db
    .select({
      id: rounds.id,
      name: rounds.name,
      qualifyingThreshold: rounds.qualifyingThreshold,
      opensAt: rounds.opensAt,
      closesAt: rounds.closesAt,
      portalId: portals.id,
      portalName: portals.name,
    })
    .from(rounds)
    .innerJoin(portals, eq(portals.id, rounds.portalId))
    .orderBy(asc(portals.name), asc(rounds.orderIndex));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    qualifying_threshold:
      row.qualifyingThreshold === null ? null : Number(row.qualifyingThreshold),
    opens_at: row.opensAt,
    closes_at: row.closesAt,
    portal: { id: row.portalId, name: row.portalName },
  }));
}

export type PublicRoundContext = {
  round: {
    id: string;
    name: string;
    opensAt: Date;
    closesAt: Date;
    resultsPublishedAt: Date | null;
  };
  portal: { id: string; name: string };
};

// Round + portal lookup shared by the round-scoped public endpoints
// (results, question papers, questions) before their access gates apply.
export async function getPublicRoundContext(
  roundId: string
): Promise<PublicRoundContext | null> {
  const [row] = await db
    .select({
      roundId: rounds.id,
      roundName: rounds.name,
      opensAt: rounds.opensAt,
      closesAt: rounds.closesAt,
      resultsPublishedAt: rounds.resultsPublishedAt,
      portalId: portals.id,
      portalName: portals.name,
    })
    .from(rounds)
    .innerJoin(portals, eq(portals.id, rounds.portalId))
    .where(eq(rounds.id, roundId))
    .limit(1);

  if (!row) return null;

  return {
    round: {
      id: row.roundId,
      name: row.roundName,
      opensAt: row.opensAt,
      closesAt: row.closesAt,
      resultsPublishedAt: row.resultsPublishedAt,
    },
    portal: { id: row.portalId, name: row.portalName },
  };
}

// Marks for the public leaderboard, highest first. Student identities are
// deliberately not selected - the contract is anonymous scores only.
export async function listRoundScores(roundId: string): Promise<number[]> {
  const rows = await db
    .select({ score: results.score })
    .from(results)
    .innerJoin(submissions, eq(submissions.id, results.submissionId))
    .where(and(eq(submissions.roundId, roundId), isNotNull(results.score)))
    .orderBy(desc(results.score));

  return rows.map((row) => Number(row.score));
}

export type PublicQuestionPaper = {
  id: string;
  public_url: string;
};

// Papers for a round. Rows without an uploaded file (online rounds auto-create
// a paper row for its duration only) are skipped.
export async function listRoundQuestionPapers(
  roundId: string
): Promise<PublicQuestionPaper[]> {
  const rows = await db
    .select({ id: questionPapers.id, fileUrl: questionPapers.fileUrl })
    .from(questionPapers)
    .where(eq(questionPapers.roundId, roundId));

  return rows.flatMap((row) =>
    row.fileUrl ? [{ id: row.id, public_url: row.fileUrl }] : []
  );
}

export type PublicQuestion = {
  id: string;
  question_type: string;
  prompt: string;
  options: unknown;
  correct_answer: unknown;
  marks: number;
  image_url: string | null;
};

// All questions of a round, correct answers included: by the time this is
// exposed the round has closed and is no longer being sat.
export async function listRoundQuestions(
  roundId: string
): Promise<PublicQuestion[]> {
  const rows = await db
    .select({
      id: questions.id,
      questionType: questions.questionType,
      prompt: questions.prompt,
      options: questions.options,
      correctAnswer: questions.correctAnswer,
      marks: questions.marks,
      imageUrl: questions.imageUrl,
    })
    .from(questions)
    .where(eq(questions.roundId, roundId));

  return rows.map((row) => ({
    id: row.id,
    question_type: row.questionType,
    prompt: row.prompt,
    options: row.options,
    correct_answer: row.correctAnswer,
    marks: row.marks,
    image_url: row.imageUrl,
  }));
}
