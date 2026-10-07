'use server';

import { createClient } from '@/lib/supabase/server';
import { parseSASTInput } from '@/lib/sast';
import { db } from '@/lib/db';
import { rounds, questionPapers, questions, portals } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  checkOnlinePublishReadiness,
  checkPhysicalPublishReadiness,
  type ReadinessResult,
} from '@/domain/question-bank/publish-readiness';
import type { PoolQuestion } from '@/domain/question-bank/variant-generator';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reuse the builder's UUID as the row id when valid, else mint a fresh one. */
function questionDbId(rawId: unknown): string {
  return typeof rawId === 'string' && UUID_RE.test(rawId)
    ? rawId
    : crypto.randomUUID();
}

/** '' / null / undefined / non-finite -> null; otherwise a truncated integer. */
function toNullableInt(raw: unknown): number | null {
  if (raw === '' || raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Parse the hidden selectedQuestionIds JSON array into a string[]. */
function parseSelectedIds(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
  } catch {
    return [];
  }
}

/**
 * Throw when any readiness checker reported an issue, so a not-ready round is
 * never written. The message aggregates the structured issue messages.
 */
function assertReady(results: ReadinessResult[]): void {
  const issues = results.flatMap((r) => r.issues);
  if (issues.length === 0) return;
  const detail = issues.map((i) => i.message).join(' ');
  throw new Error(`This round is not ready to publish. ${detail}`);
}

export async function createRound(formData: FormData) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  // Extract Form Data
  const portalId = formData.get('portalId') as string;
  const name = formData.get('name') as string;
  const orderIndex = parseInt(formData.get('orderIndex') as string, 10);
  // Entered as SAST wall-clock time, whatever the server's time zone
  const opensAt = parseSASTInput(formData.get('opensAt') as string | null);
  const closesAt = parseSASTInput(formData.get('closesAt') as string | null);
  const deliveryMethod = formData.get('deliveryMethod') as 'paper' | 'online' | 'hybrid';

  // ---------------------------------------------------------------------------
  // Portal authorization — resolved from the DB BEFORE any upload or write. A
  // Server Action is a plain POST endpoint, so the [olympiadId] URL segment is
  // not trusted: the round may only be authored into a portal the caller owns.
  // Mirrors the publishRoundResults authz pattern (portals.ownerUserId check).
  // ---------------------------------------------------------------------------
  const [portal] = await db
    .select({ ownerUserId: portals.ownerUserId })
    .from(portals)
    .where(eq(portals.id, portalId));

  if (!portal || portal.ownerUserId !== user.id) {
    throw new Error('Not authorized');
  }

  if (!opensAt || !closesAt) {
    throw new Error('Enter a valid opening and closing time.');
  }
  if (closesAt <= opensAt) {
    throw new Error('Closing time must be after the opening time.');
  }

  // The test time limit is derived from the round window (open -> close) rather
  // than entered by hand, so it can never disagree with the published schedule.
  // The create-round form no longer submits a durationMinutes field.
  const durationMinutes = Math.max(
    1,
    Math.round((closesAt.getTime() - opensAt.getTime()) / 60000)
  );

  const qualifyingThresholdRaw = formData.get('qualifyingThreshold') as string | null;
  const thresholdTopNRaw = formData.get('thresholdTopN') as string | null;
  const qualifyingThreshold =
    qualifyingThresholdRaw && qualifyingThresholdRaw.trim() !== ''
      ? qualifyingThresholdRaw.trim()
      : null;
  const thresholdTopN =
    thresholdTopNRaw && thresholdTopNRaw.trim() !== ''
      ? parseInt(thresholdTopNRaw.trim(), 10)
      : null;

  // Physical marking deadline (paper/hybrid rounds only)
  const isPaperRound = deliveryMethod === 'paper' || deliveryMethod === 'hybrid';
  const markingClosesAtRaw = (formData.get('markingClosesAt') as string | null)?.trim() ?? '';
  const markingClosesAt = isPaperRound && markingClosesAtRaw ? parseSASTInput(markingClosesAtRaw) : null;
  if (isPaperRound && markingClosesAtRaw && !markingClosesAt) {
    throw new Error('Enter a valid marking deadline.');
  }
  if (markingClosesAt && markingClosesAt <= closesAt) {
    throw new Error('The marking deadline must be after the round closes.');
  }

  // Unified target total marks (ALL delivery methods). Nullable: online rounds
  // must set a positive, reachable target (the publish guard enforces it);
  // paper/hybrid may leave it null and fall back to the selected paper total.
  const targetTotalMarksRaw = (formData.get('targetTotalMarks') as string | null)?.trim() ?? '';
  const targetTotalMarks = targetTotalMarksRaw === '' ? null : parseInt(targetTotalMarksRaw, 10);
  if (targetTotalMarks !== null && (!Number.isFinite(targetTotalMarks) || targetTotalMarks < 1)) {
    throw new Error('Target total marks must be a whole number of at least 1.');
  }

  // ---------------------------------------------------------------------------
  // Parse the question pool for EVERY delivery method. Paper rounds keep a pool
  // too, so the hand-picked physical selection (and the PDF built from it) has a
  // real source. Blank builder placeholders (no prompt) are never persisted.
  // ---------------------------------------------------------------------------
  const questionsDataStr = (formData.get('questionsData') as string | null) ?? '';
  const rawQuestions: any[] = JSON.parse(questionsDataStr || '[]');
  const questionsArray = rawQuestions.filter(
    (q) => q && typeof q.prompt === 'string' && q.prompt.trim() !== ''
  );

  // Online / hybrid questions are auto-marked, so each must carry a valid
  // answer. Paper-only pools are printed, not auto-marked, so skip this.
  if (deliveryMethod === 'online' || deliveryMethod === 'hybrid') {
    for (let i = 0; i < questionsArray.length; i++) {
      const q = questionsArray[i];
      if (q.type === 'free_text') {
        if (!q.correctAnswer || (typeof q.correctAnswer === 'string' && q.correctAnswer.trim() === '')) {
          throw new Error(`Question ${i + 1} requires marking guidelines/answers for the educator.`);
        }
      } else if (q.type === 'single_choice' || q.type === 'multiple_choice' || q.type === 'true_false') {
        let hasAnswer = false;
        if (Array.isArray(q.correctAnswer)) {
          hasAnswer = q.correctAnswer.length > 0;
          if (hasAnswer && q.options) {
            const allValid = q.correctAnswer.every((ans: string) => q.options.includes(ans));
            if (!allValid) hasAnswer = false;
          }
        } else if (typeof q.correctAnswer === 'string' && q.correctAnswer.trim() !== '') {
          if (q.options) {
            hasAnswer = q.options.includes(q.correctAnswer);
          } else {
            hasAnswer = true;
          }
        }

        if (!hasAnswer) {
          throw new Error(`Question ${i + 1} requires an answer to be selected from the options for auto-marking.`);
        }
      } else if (q.type === 'matching') {
        if (!q.options || q.options.length === 0) {
          throw new Error(`Question ${i + 1} requires matching pairs.`);
        }
      }
    }
  }

  // Assign each question a stable DB id. The builder mints UUIDs, so reuse them
  // (this keeps the physical selection's ids lined up 1:1 with the rows); mint a
  // fresh UUID only when the incoming id is missing or not a UUID.
  const idMap = new Map<string, string>();
  const questionsWithIds = questionsArray.map((q) => {
    const dbId = questionDbId(q.id);
    if (typeof q.id === 'string' && q.id !== '') idMap.set(q.id, dbId);
    return { q, dbId };
  });

  // In-memory pool for the readiness guard (marks / difficulty nullable).
  const pool: PoolQuestion[] = questionsWithIds.map(({ q, dbId }) => ({
    id: dbId,
    marks: toNullableInt(q.marks),
    difficulty: toNullableInt(q.difficulty),
  }));

  // The organiser's ordered physical selection, mapped onto DB ids.
  const selectedClientIds = parseSelectedIds(formData.get('selectedQuestionIds'));
  const selectedQuestionIds = selectedClientIds
    .map((cid) => idMap.get(cid))
    .filter((x): x is string => typeof x === 'string');

  // ---------------------------------------------------------------------------
  // Publish-readiness guard — runs BEFORE any storage upload or DB write, so a
  // not-ready round neither leaks an uploaded file nor persists half a round.
  // The SAME pure checkers power the advisory client-side PublishReadinessPanel.
  // ---------------------------------------------------------------------------
  const readiness: ReadinessResult[] = [];
  const isOnlineish = deliveryMethod === 'online' || deliveryMethod === 'hybrid';
  const isPhysicalish = deliveryMethod === 'paper' || deliveryMethod === 'hybrid';
  if (isOnlineish) {
    readiness.push(checkOnlinePublishReadiness(pool, targetTotalMarks ?? 0));
  }
  // A pure paper round that only uploads a PDF (empty pool, no selection) has
  // nothing to guard; require a selection only once a pool/selection exists.
  // Hybrid always guards both dimensions.
  const physicalApplies =
    deliveryMethod === 'hybrid' || selectedQuestionIds.length > 0 || pool.length > 0;
  if (isPhysicalish && physicalApplies) {
    readiness.push(checkPhysicalPublishReadiness(pool, selectedQuestionIds));
  }
  assertReady(readiness);

  // ---------------------------------------------------------------------------
  // All Supabase Storage uploads happen BEFORE any database write. Storage
  // objects cannot be rolled back, so doing them first means a later DB failure
  // never leaves an orphaned round behind (at worst we leak an unused file).
  // ---------------------------------------------------------------------------

  // 1. Question paper PDF (paper / hybrid rounds)
  let paperUrl: string | null = null;
  if (deliveryMethod === 'paper' || deliveryMethod === 'hybrid') {
    const questionPaperFile = formData.get('questionPaper') as File | null;
    if (!questionPaperFile || questionPaperFile.size === 0) {
      throw new Error('A question paper PDF is required for paper or hybrid rounds.');
    }

    const fileExtension = questionPaperFile.name.split('.').pop() || 'pdf';
    const uniqueFileName = `papers/${crypto.randomUUID()}.${fileExtension}`;

    const { error: uploadError } = await supabase.storage
      .from('round-documents')
      .upload(uniqueFileName, questionPaperFile, {
        contentType: 'application/pdf',
      });

    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

    const { data: publicUrlData } = supabase.storage
      .from('round-documents')
      .getPublicUrl(uniqueFileName);
    paperUrl = publicUrlData.publicUrl;
  }

  // 2. Question rows (ALL methods): upload any images and build the inserts.
  //    marks / difficulty are nullable now (a draft pool question may omit them;
  //    the guard above already proved any *used* question carries what it needs).
  const questionInserts: Array<{
    id: string;
    questionType: any;
    prompt: any;
    imageUrl: string | null;
    marks: number | null;
    difficulty: number | null;
    options: any;
    correctAnswer: any;
  }> = [];

  const prepared = await Promise.all(
    questionsWithIds.map(async ({ q, dbId }) => {
      let imageUrl: string | null = q.imageUrl || null;
      const imageFile = formData.get(`image_${q.id}`) as File | null;

      if (imageFile && imageFile.size > 0) {
        const fileExtension = imageFile.name.split('.').pop() || 'png';
        const uniqueFileName = `${crypto.randomUUID()}.${fileExtension}`;

        const { error: uploadError } = await supabase.storage
          .from('question-images')
          .upload(uniqueFileName, imageFile, {
            contentType: imageFile.type,
          });

        if (!uploadError) {
          const { data } = supabase.storage
            .from('question-images')
            .getPublicUrl(uniqueFileName);
          imageUrl = data.publicUrl;
        } else {
          console.error('Failed to upload image:', uploadError);
        }
      }

      return {
        id: dbId,
        questionType: q.type,
        prompt: q.prompt,
        imageUrl,
        marks: toNullableInt(q.marks),
        difficulty: toNullableInt(q.difficulty),
        options: q.options || null,
        correctAnswer: q.correctAnswer || null,
      };
    })
  );

  questionInserts.push(...prepared);

  // ---------------------------------------------------------------------------
  // Single atomic transaction: the round, its question paper and its questions
  // are all committed together, or none of them are. This is what prevents a
  // half-created round when a later insert fails.
  // ---------------------------------------------------------------------------
  const newRound = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(rounds)
      .values({
        portalId,
        name,
        orderIndex,
        deliveryMethod,
        opensAt,
        closesAt,
        qualifyingThreshold: qualifyingThreshold ?? undefined,
        thresholdTopN: thresholdTopN ?? undefined,
        markingClosesAt,
        targetTotalMarks,
      })
      .returning({ id: rounds.id });

    if (!created) throw new Error('Failed to create round');

    // A question paper row is required for every delivery method: online
    // sittings reference it (and its durationMinutes), paper/hybrid store the
    // uploaded PDF URL and the organiser's ordered physical selection here.
    await tx.insert(questionPapers).values({
      roundId: created.id,
      fileUrl: paperUrl,
      durationMinutes,
      answerKeyJson: null,
      isMultipleChoice: false,
      selectedQuestionIds: selectedQuestionIds.length > 0 ? selectedQuestionIds : null,
    });

    if (questionInserts.length > 0) {
      await tx.insert(questions).values(
        questionInserts.map((q) => ({ ...q, roundId: created.id }))
      );
    }

    return created;
  });

  if (!newRound) throw new Error('Failed to create round');

  revalidatePath(`/organiser/olympiads/${portalId}`);
  redirect(`/organiser/olympiads/${portalId}`);
}
