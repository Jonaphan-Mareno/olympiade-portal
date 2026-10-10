// Marked paper scripts: uploading (educator original pages, re-marked pages
// during a remark), listing, and authorising a single page view. Rules live in
// ./script-rules; this module does the db and storage work around them.
//
// Uploading is two steps so large phone photos never pass through a server
// action body:
//   1. prepareScriptUpload: authorise, check each page's type/size/count and
//      issue one signed upload URL per page into the private bucket.
//   2. commitScriptUpload: authorise again, download what was uploaded, check
//      the real bytes, then swap the page rows in one transaction and delete
//      the replaced objects. Anything that fails is deleted from storage.

import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import {
  memberships,
  results,
  rounds,
  submissionScriptPages,
  submissions,
} from '@/lib/db/schema';
import { and, asc, count, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import {
  createScriptUploadUrl,
  downloadScriptObject,
  removeScriptObjects,
} from '@/lib/storage/marked-scripts';
import {
  buildScriptPath,
  decideScriptAccess,
  isScriptPathFor,
  isUuid,
  validatePageCount,
  validatePageMeta,
  validateUploadedPage,
  type ScriptImageType,
  type ScriptKind,
} from './script-rules';
import { canResolveRemark, getRemarkRequest } from '../remarks/remarks';
import {
  checkEntrantsAtEducatorSchools,
  findOrCreateOfflineSubmission,
  loadOfflineMarkingRound,
} from '../rounds/offline-marks';

export type ScriptPage = {
  id: string;
  kind: ScriptKind;
  remarkRequestId: string | null;
  pageIndex: number;
};

/** Every page of a submission's script, originals first, in page order. */
export async function getScriptPages(submissionId: string): Promise<ScriptPage[]> {
  return db
    .select({
      id: submissionScriptPages.id,
      kind: submissionScriptPages.kind,
      remarkRequestId: submissionScriptPages.remarkRequestId,
      pageIndex: submissionScriptPages.pageIndex,
    })
    .from(submissionScriptPages)
    .where(eq(submissionScriptPages.submissionId, submissionId))
    .orderBy(asc(submissionScriptPages.kind), asc(submissionScriptPages.pageIndex));
}

/** Number of original pages per submission. */
export async function getScriptPageCounts(
  submissionIds: string[]
): Promise<Map<string, number>> {
  if (submissionIds.length === 0) return new Map();
  const rows = await db
    .select({ submissionId: submissionScriptPages.submissionId, pages: count() })
    .from(submissionScriptPages)
    .where(
      and(
        inArray(submissionScriptPages.submissionId, submissionIds),
        eq(submissionScriptPages.kind, 'original')
      )
    )
    .groupBy(submissionScriptPages.submissionId);
  return new Map(rows.map((r) => [r.submissionId, Number(r.pages)]));
}

/** Offline entrants of a round who have a mark but no uploaded script. */
export async function countScoredEntrantsWithoutScript(roundId: string): Promise<number> {
  const [row] = await db
    .select({ missing: count() })
    .from(submissions)
    .innerJoin(results, eq(results.submissionId, submissions.id))
    .leftJoin(
      submissionScriptPages,
      and(
        eq(submissionScriptPages.submissionId, submissions.id),
        eq(submissionScriptPages.kind, 'original')
      )
    )
    .where(
      and(
        eq(submissions.roundId, roundId),
        eq(submissions.submissionType, 'offline'),
        isNotNull(results.score),
        isNull(submissionScriptPages.id)
      )
    );
  return Number(row?.missing ?? 0);
}

/**
 * The page's storage location if `userId` may view it, else null. "Not found"
 * and "not allowed" are deliberately indistinguishable, so guessing ids
 * reveals nothing.
 */
export async function getViewableScriptPage(
  userId: string,
  pageId: string
): Promise<{ storagePath: string; contentType: string } | null> {
  if (!isUuid(pageId)) return null;

  const [row] = await db
    .select({
      storagePath: submissionScriptPages.storagePath,
      contentType: submissionScriptPages.contentType,
      portalId: rounds.portalId,
      resultsPublishedAt: rounds.resultsPublishedAt,
      entrantUserId: memberships.userId,
      studentSchoolId: memberships.schoolId,
    })
    .from(submissionScriptPages)
    .innerJoin(submissions, eq(submissions.id, submissionScriptPages.submissionId))
    .innerJoin(rounds, eq(rounds.id, submissions.roundId))
    .leftJoin(memberships, eq(memberships.id, submissions.studentMembershipId))
    .where(eq(submissionScriptPages.id, pageId));
  if (!row) return null;

  const isPublishedOwner =
    row.entrantUserId === userId && row.resultsPublishedAt !== null;
  const canMark = isPublishedOwner
    ? false
    : await canResolveRemark(userId, {
        portalId: row.portalId,
        studentSchoolId: row.studentSchoolId,
      });

  const allowed = decideScriptAccess({
    userId,
    entrantUserId: row.entrantUserId,
    resultsPublishedAt: row.resultsPublishedAt,
    canMark,
  });
  return allowed ? { storagePath: row.storagePath, contentType: row.contentType } : null;
}

export type ScriptUploadTarget =
  // An educator's marked script for one entrant (offline-marks page)
  | { kind: 'original'; roundId: string; studentMembershipId: string }
  // Re-marked pages added while resolving a paper remark
  | { kind: 'remarked'; remarkRequestId: string };

type ResolvedTarget = {
  roundId: string;
  submissionId: string;
  kind: ScriptKind;
  remarkRequestId: string | null;
};

/**
 * Authorises an upload and finds the submission it belongs to.
 * Original pages: the same checks as entering marks (accepted educator at the
 * entrant's school, paper round, marking window open), creating the offline
 * submission if the entrant has none yet. Re-marked pages: the remark must be
 * a pending paper remark the user may resolve.
 */
async function resolveUploadTarget(
  userId: string,
  target: ScriptUploadTarget
): Promise<{ error: string } | ResolvedTarget> {
  if (target.kind === 'original') {
    const loaded = await loadOfflineMarkingRound(userId, target.roundId);
    if ('error' in loaded) return { error: loaded.error };
    const { round, educatorBySchool } = loaded;

    const checked = await checkEntrantsAtEducatorSchools(round, educatorBySchool, [
      target.studentMembershipId,
    ]);
    if ('error' in checked) return { error: checked.error };

    const gradedBy = educatorBySchool.get(
      checked.studentSchool.get(target.studentMembershipId) ?? null
    )!;
    const submissionId = await findOrCreateOfflineSubmission(
      round.id,
      target.studentMembershipId,
      gradedBy
    );
    if (!submissionId) {
      return { error: 'This entrant wrote the round online, so there is no paper script.' };
    }
    return { roundId: round.id, submissionId, kind: 'original', remarkRequestId: null };
  }

  const request = await getRemarkRequest(target.remarkRequestId);
  if (!request) return { error: 'Remark request not found.' };
  if (request.submissionType === 'online') {
    return { error: 'Re-marked pages can only be uploaded for paper scripts.' };
  }
  if (request.status === 'resolved') return { error: 'This remark has already been resolved.' };
  if (request.status === 'withdrawn') return { error: 'The entrant withdrew this remark request.' };
  if (!(await canResolveRemark(userId, request))) {
    return { error: 'You are not allowed to remark this paper.' };
  }
  return {
    roundId: request.roundId,
    submissionId: request.submissionId,
    kind: 'remarked',
    remarkRequestId: request.id,
  };
}

/** Step 1: validate the pages and issue a signed upload URL for each. */
export async function prepareScriptUpload(
  userId: string,
  target: ScriptUploadTarget,
  files: { contentType: string; size: number }[]
): Promise<{ error: string } | { uploads: { path: string; token: string }[] }> {
  const countError = validatePageCount(files.length);
  if (countError) return { error: countError };
  for (const file of files) {
    const metaError = validatePageMeta(file);
    if (metaError) return { error: metaError };
  }

  const resolved = await resolveUploadTarget(userId, target);
  if ('error' in resolved) return resolved;

  const uploads: { path: string; token: string }[] = [];
  for (const file of files) {
    const path = buildScriptPath(
      resolved.roundId,
      resolved.submissionId,
      resolved.kind,
      randomUUID(),
      file.contentType as ScriptImageType
    );
    const signed = await createScriptUploadUrl(path);
    if (!signed) return { error: 'Could not start the upload. Please try again.' };
    uploads.push({ path, token: signed.token });
  }
  return { uploads };
}

/**
 * Step 2: check what was actually uploaded and make it the script, replacing
 * the previous pages of the same kind (never the originals, for a remark).
 */
export async function commitScriptUpload(
  userId: string,
  target: ScriptUploadTarget,
  pages: { path: string; contentType: string }[]
): Promise<{ error: string } | { pageCount: number }> {
  const resolved = await resolveUploadTarget(userId, target);
  // Paths we issued for this submission and kind, safe to clean up on failure
  const ownPaths = 'error' in resolved
    ? []
    : pages
        .map((p) => p.path)
        .filter((p) =>
          isScriptPathFor(p, resolved.roundId, resolved.submissionId, resolved.kind)
        );
  const fail = async (error: string) => {
    await removeScriptObjects(ownPaths);
    return { error };
  };

  if ('error' in resolved) return resolved;

  const countError = validatePageCount(pages.length);
  if (countError) return fail(countError);
  if (
    ownPaths.length !== pages.length ||
    new Set(ownPaths).size !== ownPaths.length
  ) {
    return fail('The upload did not match this script. Please try again.');
  }

  const checked: { path: string; contentType: ScriptImageType; size: number }[] = [];
  for (const page of pages) {
    const blob = await downloadScriptObject(page.path);
    if (!blob) return fail('One of the pages did not finish uploading. Please try again.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const result = validateUploadedPage(bytes, page.contentType);
    if ('error' in result) return fail(result.error);
    checked.push({ path: page.path, contentType: result.contentType, size: bytes.length });
  }

  const sameScript = and(
    eq(submissionScriptPages.submissionId, resolved.submissionId),
    eq(submissionScriptPages.kind, resolved.kind),
    resolved.remarkRequestId
      ? eq(submissionScriptPages.remarkRequestId, resolved.remarkRequestId)
      : isNull(submissionScriptPages.remarkRequestId)
  );

  let replaced: string[];
  try {
    replaced = await db.transaction(async (tx) => {
      const previous = await tx
        .select({ storagePath: submissionScriptPages.storagePath })
        .from(submissionScriptPages)
        .where(sameScript);
      await tx.delete(submissionScriptPages).where(sameScript);
      await tx.insert(submissionScriptPages).values(
        checked.map((page, pageIndex) => ({
          submissionId: resolved.submissionId,
          kind: resolved.kind,
          remarkRequestId: resolved.remarkRequestId,
          pageIndex,
          storagePath: page.path,
          contentType: page.contentType,
          sizeBytes: page.size,
          uploadedByUserId: userId,
        }))
      );
      return previous.map((p) => p.storagePath);
    });
  } catch (err) {
    console.error('Failed to save script pages:', err);
    return fail('Could not save the script. Please try again.');
  }

  // The replaced pages are no longer referenced; don't leave them behind
  await removeScriptObjects(replaced.filter((p) => !ownPaths.includes(p)));
  return { pageCount: checked.length };
}

/**
 * Deletes pages uploaded for an abandoned or failed upload. Only paths issued
 * for this target's submission and kind, and not part of a saved script.
 */
export async function discardScriptUpload(
  userId: string,
  target: ScriptUploadTarget,
  paths: string[]
): Promise<void> {
  const resolved = await resolveUploadTarget(userId, target);
  if ('error' in resolved) return;
  const own = paths.filter((p) =>
    isScriptPathFor(p, resolved.roundId, resolved.submissionId, resolved.kind)
  );
  if (own.length === 0) return;
  const saved = await db
    .select({ storagePath: submissionScriptPages.storagePath })
    .from(submissionScriptPages)
    .where(inArray(submissionScriptPages.storagePath, own));
  const savedPaths = new Set(saved.map((s) => s.storagePath));
  await removeScriptObjects(own.filter((p) => !savedPaths.has(p)));
}
