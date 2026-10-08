'use server';

import { createClient } from '@/lib/supabase/server';
import { parseSASTInput } from '@/lib/sast';
import { db } from '@/lib/db';
import {
  rounds,
  questions,
  questionPapers,
  examSittings,
  portals,
} from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { deriveRoundState } from '@/domain/rounds/round-state-machine';
import { getMarkingDeadline } from '@/domain/rounds/paper-marking';
import type { DispatchSummary } from '@/domain/notifications/automation-engine';
import {
  loadActiveRules,
  runDueRules,
} from '@/domain/notifications/automation-rules';
import { notifyEducatorsInPortal } from '@/domain/notifications/in-app-notifications';
import { advanceQualifyingEntrants, type AdvancementSummary } from '@/domain/rounds/advance-entrants';
import type { Round } from '@/domain/rounds/round.types';
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

export async function updateRound(formData: FormData) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  // Extract Form Data
  const portalId = formData.get('portalId') as string;
  const roundId = formData.get('roundId') as string;
  const name = formData.get('name') as string;
  const orderIndex = parseInt(formData.get('orderIndex') as string, 10);
  // Entered as SAST wall-clock time, whatever the server's time zone
  const opensAt = parseSASTInput(formData.get('opensAt') as string | null);
  const closesAt = parseSASTInput(formData.get('closesAt') as string | null);
  const deliveryMethod = formData.get('deliveryMethod') as 'paper' | 'online' | 'hybrid';

  // ---------------------------------------------------------------------------
  // Round + portal authorization — resolved from the DB BEFORE any write. A
  // Server Action is a plain POST endpoint, so neither the [olympiadId] URL
  // segment nor the submitted roundId/portalId are trusted: we join portals on
  // rounds.portalId, match BOTH rounds.id AND rounds.portalId, and enforce that
  // the caller owns the portal. Mirrors the publishRoundResults authz pattern.
  // Without this any logged-in user (including a student) could rewrite any
  // round: flip targetTotalMarks (the single score denominator), delete the
  // whole question pool, or bypass the live-sitting edit lock.
  // ---------------------------------------------------------------------------
  const [authorizedRound] = await db
    .select({
      id: rounds.id,
      portalId: rounds.portalId,
      deliveryMethod: rounds.deliveryMethod,
      portalOwnerId: portals.ownerUserId,
    })
    .from(rounds)
    .innerJoin(portals, eq(portals.id, rounds.portalId))
    .where(and(eq(rounds.id, roundId), eq(rounds.portalId, portalId)));

  if (!authorizedRound || authorizedRound.portalOwnerId !== user.id) {
    throw new Error('Not authorized');
  }

  // The live-sitting edit lock is keyed on the STORED round, never the
  // attacker-supplied form field, so posting deliveryMethod:'paper' for a live
  // online round can no longer skip the lock.
  const storedDeliveryMethod = authorizedRound.deliveryMethod as
    | 'paper'
    | 'online'
    | 'hybrid';

  if (!opensAt || !closesAt) {
    throw new Error('Enter a valid opening and closing time.');
  }
  if (closesAt <= opensAt) {
    throw new Error('Closing time must be after the opening time.');
  }

  // The test time limit is derived from the round window (open -> close) rather
  // than entered by hand, so it can never disagree with the published schedule.
  // The edit-round form no longer submits a durationMinutes field.
  const durationMinutes = Math.max(
    1,
    Math.round((closesAt.getTime() - opensAt.getTime()) / 60000)
  );

  const qualifyingThresholdRaw = formData.get('qualifyingThreshold') as string;
  const thresholdTopNRaw = formData.get('thresholdTopN') as string;
  const qualifyingThreshold = qualifyingThresholdRaw && qualifyingThresholdRaw.trim() !== '' ? qualifyingThresholdRaw.trim() : null;
  const thresholdTopN = thresholdTopNRaw && thresholdTopNRaw.trim() !== '' ? parseInt(thresholdTopNRaw.trim(), 10) : null;

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
  // Parse the question pool for EVERY delivery method (paper rounds keep a pool
  // too, so the physical selection and the PDF built from it have a source).
  // Blank builder placeholders (no prompt) are never persisted.
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

  // ---------------------------------------------------------------------------
  // hasLiveSittings edit lock (online/hybrid). Checked BEFORE any write so a
  // locked round is never partially updated. Keyed on the STORED delivery
  // method (not the submitted form field). Any variants already dealt to
  // students are frozen and will not change.
  // ---------------------------------------------------------------------------
  let paperRecord = await db
    .select()
    .from(questionPapers)
    .where(eq(questionPapers.roundId, roundId))
    .limit(1);

  if (storedDeliveryMethod === 'online' || storedDeliveryMethod === 'hybrid') {
    if (paperRecord && paperRecord.length > 0) {
      const sittings = await db
        .select()
        .from(examSittings)
        .where(eq(examSittings.questionPaperId, paperRecord[0].id))
        .limit(1);
      if (sittings.length > 0) {
        throw new Error(
          'This round cannot be edited because students have already begun their attempts. Any variants already dealt to students are frozen and will not change.'
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // id-preserving upsert plan. Load the existing questions so we can UPDATE rows
  // whose id is unchanged, INSERT genuinely new rows, and DELETE only rows that
  // disappeared from the payload. This never blanket-deletes, so a persisted
  // selectedQuestionIds / dealt variantQuestionIds is never orphaned and
  // studentAnswers are never cascade-deleted.
  // ---------------------------------------------------------------------------
  const existingQuestions = await db
    .select({ id: questions.id })
    .from(questions)
    .where(eq(questions.roundId, roundId));
  const existingIds = new Set<string>(
    (existingQuestions ?? []).map((r: any) => r.id)
  );

  // Assign each payload question a stable DB id and classify update vs insert.
  const idMap = new Map<string, string>();
  const planned = questionsArray.map((q) => {
    const dbId = questionDbId(q.id);
    if (typeof q.id === 'string' && q.id !== '') idMap.set(q.id, dbId);
    return { q, dbId, isUpdate: existingIds.has(dbId) };
  });
  const payloadDbIds = new Set(planned.map((p) => p.dbId));
  const absentIds = [...existingIds].filter((id) => !payloadDbIds.has(id));

  // In-memory pool for the readiness guard (marks / difficulty nullable).
  const pool: PoolQuestion[] = planned.map(({ q, dbId }) => ({
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
  // Publish-readiness guard — runs BEFORE any write. The SAME pure checkers
  // power the advisory client-side PublishReadinessPanel.
  //
  // Backward-compat exemption (no backfill, no flag day): a LEGACY round is one
  // that predates difficulty/target authoring — it carries no target total AND
  // every pool question has a null difficulty. Running the online/physical
  // checkers against such a round would fail ("needs a difficulty", "set a
  // target total") and make it impossible to so much as fix a typo or adjust
  // the open/close window without retrofitting the whole pool. So legacy rounds
  // skip the readiness checks; any round with a target set OR any difficulty
  // set is guarded authoritatively before the write.
  // ---------------------------------------------------------------------------
  const isLegacyRound =
    targetTotalMarks === null && pool.every((q) => q.difficulty === null);

  if (!isLegacyRound) {
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
  }

  // ---------------------------------------------------------------------------
  // Writes. Update the round (incl. the unified target total marks).
  // ---------------------------------------------------------------------------
  await db
    .update(rounds)
    .set({
      name,
      orderIndex,
      opensAt,
      closesAt,
      qualifyingThreshold,
      thresholdTopN,
      markingClosesAt,
      targetTotalMarks,
    })
    .where(eq(rounds.id, roundId));

  // Prepare question rows (uploading any images), preserving each row's id.
  const preparedRows = await Promise.all(
    planned.map(async ({ q, dbId }) => {
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
        roundId,
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

  // Question paper row: paper/hybrid carry the PDF + the ordered physical
  // selection; online only keeps the derived duration in sync.
  if (deliveryMethod === 'paper' || deliveryMethod === 'hybrid') {
    const questionPaperFile = formData.get('questionPaper') as File | null;
    const answerKeyFile = formData.get('answerKey') as File | null;

    let fileUrl = paperRecord[0]?.fileUrl || null;
    let answerKeyJson = paperRecord[0]?.answerKeyJson || null;

    if (questionPaperFile && questionPaperFile.size > 0) {
      const fileExtension = questionPaperFile.name.split('.').pop() || 'pdf';
      const uniqueFileName = `papers/${crypto.randomUUID()}.${fileExtension}`;

      const { error: uploadError } = await supabase.storage
        .from('round-documents')
        .upload(uniqueFileName, questionPaperFile, { contentType: 'application/pdf' });

      if (!uploadError) {
        const { data } = supabase.storage.from('round-documents').getPublicUrl(uniqueFileName);
        fileUrl = data.publicUrl;

        // Notify educators that the paper is available
        await notifyEducatorsInPortal(
          portalId,
          'Question Paper Available',
          `The question paper for ${name} is now available for download.`,
          `/educator/olympiads/${portalId}/rounds/${roundId}`
        );
      }
    }

    if (answerKeyFile && answerKeyFile.size > 0) {
      const fileExtension = answerKeyFile.name.split('.').pop() || 'pdf';
      const uniqueFileName = `papers/${crypto.randomUUID()}.${fileExtension}`;

      const { error: uploadError } = await supabase.storage
        .from('round-documents')
        .upload(uniqueFileName, answerKeyFile, { contentType: 'application/pdf' });

      if (!uploadError) {
        const { data } = supabase.storage.from('round-documents').getPublicUrl(uniqueFileName);
        const currentAnswerKeyObj = (typeof answerKeyJson === 'object' && answerKeyJson !== null) ? answerKeyJson : {};
        answerKeyJson = { ...currentAnswerKeyObj, memoUrl: data.publicUrl };
      }
    }

    const selection = selectedQuestionIds.length > 0 ? selectedQuestionIds : null;
    if (paperRecord.length === 0) {
      await db.insert(questionPapers).values({
        roundId,
        durationMinutes,
        fileUrl,
        answerKeyJson,
        isMultipleChoice: false,
        selectedQuestionIds: selection,
      });
      paperRecord = await db.select().from(questionPapers).where(eq(questionPapers.roundId, roundId)).limit(1);
    } else {
      await db.update(questionPapers).set({
        durationMinutes,
        fileUrl,
        answerKeyJson,
        selectedQuestionIds: selection,
      }).where(eq(questionPapers.id, paperRecord[0].id));
    }
  } else if (paperRecord.length === 0) {
    await db.insert(questionPapers).values({ roundId, durationMinutes });
    paperRecord = await db.select().from(questionPapers).where(eq(questionPapers.roundId, roundId)).limit(1);
  } else {
    await db.update(questionPapers).set({ durationMinutes }).where(eq(questionPapers.id, paperRecord[0].id));
  }

  // Apply the id-preserving question upsert: update unchanged ids, insert new
  // ones, delete only the rows that vanished from the payload.
  for (let i = 0; i < preparedRows.length; i++) {
    if (!planned[i].isUpdate) continue;
    const { id, ...rest } = preparedRows[i];
    await db.update(questions).set(rest).where(eq(questions.id, id));
  }

  const inserts = preparedRows.filter((_, i) => !planned[i].isUpdate);
  if (inserts.length > 0) {
    await db.insert(questions).values(inserts);
  }

  if (absentIds.length > 0) {
    await db.delete(questions).where(inArray(questions.id, absentIds));
  }

  revalidatePath(`/organiser/olympiads/${portalId}`);
  redirect(`/organiser/olympiads/${portalId}`);
}

export async function deleteRound(roundId: string, portalId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const [round] = await db.select().from(rounds).where(eq(rounds.id, roundId));
  if (!round) throw new Error('Round not found');

  const roundState = deriveRoundState(round, new Date());
  if (roundState !== 'scheduled') {
    throw new Error('Cannot delete a round that has already opened or started.');
  }

  // We can rely on ON DELETE CASCADE in the database to remove questions, question_papers, submissions etc.
  await db.delete(rounds).where(eq(rounds.id, roundId));

  revalidatePath(`/organiser/olympiads/${portalId}`);
  redirect(`/organiser/olympiads/${portalId}`);
}

/**
 * Releases a round's results: stamps rounds.resultsPublished_at (moving the
 * round to its final 'released' state) and immediately emails every educator
 * a school-level summary and every entrant who submitted their own result.
 * Safe to call more than once — notification_log deduplicates per recipient.
 */
export async function publishRoundResults(
  formData: FormData
): Promise<{
  error?: string;
  alreadyPublished?: boolean;
  summary?: DispatchSummary;
  advancementSummary?: AdvancementSummary | null;
}> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const portalId = formData.get('portalId') as string;
  const roundId = formData.get('roundId') as string;

  const [row] = await db
    .select({
      id: rounds.id,
      portalId: rounds.portalId,
      name: rounds.name,
      orderIndex: rounds.orderIndex,
      deliveryMethod: rounds.deliveryMethod,
      opensAt: rounds.opensAt,
      closesAt: rounds.closesAt,
      qualifyingThreshold: rounds.qualifyingThreshold,
      resultsPublishedAt: rounds.resultsPublishedAt,
      markingClosesAt: rounds.markingClosesAt,
      portalName: portals.name,
      portalOwnerId: portals.ownerUserId,
    })
    .from(rounds)
    .innerJoin(portals, eq(portals.id, rounds.portalId))
    .where(and(eq(rounds.id, roundId), eq(rounds.portalId, portalId)));

  // Only the portal owner may release results
  if (!row || row.portalOwnerId !== user.id) {
    throw new Error('Not authorized to publish results for this round');
  }

  if (row.resultsPublishedAt) {
    // Already released — re-send is a no-op thanks to notification_log
    revalidatePath(`/organiser/olympiads/${portalId}/rounds/${roundId}`);
    return { alreadyPublished: true };
  }

  // Results can only be released once the round has closed
  if (deriveRoundState(row) !== 'closed') {
    return {
      error: 'Results can only be published after the round has closed.',
    };
  }

  // Paper scripts are marked by schools: wait for their marking deadline so
  // no school is locked out of entering marks
  if (row.deliveryMethod !== 'online') {
    const deadline = getMarkingDeadline(row);
    if (new Date() < deadline) {
      return {
        error: `Schools can enter physical marks until ${deadline.toLocaleString('en-GB', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short' })} SAST. Publish after the marking deadline, or move the deadline earlier if every school has finished.`,
      };
    }
  }

  const publishedAt = new Date();
  await db
    .update(rounds)
    .set({ resultsPublishedAt: publishedAt })
    .where(eq(rounds.id, roundId));

  const round: Round = {
    id: row.id,
    portalId: row.portalId,
    portalName: row.portalName,
    name: row.name,
    orderIndex: row.orderIndex,
    deliveryMethod: row.deliveryMethod,
    opensAt: row.opensAt,
    closesAt: row.closesAt,
    qualifyingThreshold: row.qualifyingThreshold,
    resultsPublishedAt: publishedAt,
  };

  // Send whatever the organiser's "results published" automation rules say
  // is due right now (rules with a delay are picked up by the hourly sweep).
  let summary: DispatchSummary;
  try {
    const rules = (await loadActiveRules([portalId])).get(portalId) ?? [];
    summary = (
      await runDueRules(
        rules.filter((r) => r.triggerType === 'results_published'),
        round,
        publishedAt
      )
    ).summary;
  } catch (err) {
    console.error('Failed to send results-published notifications:', err);
    summary = { sent: 0, skipped: 0, failed: 0 };
  }

  // Auto-advance qualifying entrants into the next round
  let advancementSummary = null;
  try {
    advancementSummary = await advanceQualifyingEntrants(roundId);
  } catch (err) {
    console.error('Failed to advance entrants:', err);
  }

  revalidatePath(`/organiser/olympiads/${portalId}/rounds/${roundId}`);
  revalidatePath(`/organiser/olympiads/${portalId}`);

  return { summary, advancementSummary };
}
