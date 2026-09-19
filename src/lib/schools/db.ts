import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { schools } from '@/lib/db/schema';
import type { PickedSchool } from './types';

// Whatever Drizzle hands the db.transaction callback.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Find-or-create the portal's school row for a picked school. Schools are
// picked from the shared directories (never free-typed), but rows stay
// per-portal; re-inviting the same school must reuse the existing row
// instead of piling up duplicates.
//
// Legacy rows created before the school picker have type = NULL; matching
// one by name heals it with the picked type and external id.
export async function ensureSchool(
  tx: Tx,
  portalId: string,
  picked: PickedSchool
): Promise<{ id: string; name: string }> {
  const [existing] = await tx
    .select({ id: schools.id, name: schools.name, type: schools.type })
    .from(schools)
    .where(
      and(
        eq(schools.portalId, portalId),
        sql`lower(${schools.name}) = ${picked.name.toLowerCase()}`,
        or(eq(schools.type, picked.type), isNull(schools.type))
      )
    );

  if (existing) {
    if (existing.type == null) {
      await tx
        .update(schools)
        .set({ type: picked.type, externalId: picked.externalId })
        .where(eq(schools.id, existing.id));
    }
    return existing;
  }

  const [created] = await tx
    .insert(schools)
    .values({
      portalId,
      name: picked.name,
      type: picked.type,
      externalId: picked.externalId,
    })
    .returning({ id: schools.id, name: schools.name });

  return created;
}
