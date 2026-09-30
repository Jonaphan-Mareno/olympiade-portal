import { db } from '@/lib/db';
import { certificateTemplates } from '@/lib/db/schema';
import { inArray } from 'drizzle-orm';

/**
 * Returns the subset of the given round IDs that have at least one certificate
 * template configured by the organiser.
 *
 * Students must only be offered a certificate download for rounds in this set.
 * For any other round the `/api/certificates/[submissionId]` endpoint responds
 * with `404 "Certificate templates not configured for this round"`, which the
 * student would otherwise hit by clicking a dead download link.
 */
export async function getRoundIdsWithCertificates(
  roundIds: string[]
): Promise<Set<string>> {
  const uniqueIds = [...new Set(roundIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return new Set<string>();
  }

  const rows = await db
    .selectDistinct({ roundId: certificateTemplates.roundId })
    .from(certificateTemplates)
    .where(inArray(certificateTemplates.roundId, uniqueIds));

  return new Set(rows.map((row) => row.roundId));
}
