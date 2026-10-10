// An educator's "active school" for the dashboard.
//
// Schools are stored per olympiad: the same school invited to two olympiads is
// two `schools` rows with the same name. The educator should see it once and
// get everything for it, so the school picker lists each school once and the
// educator pages work on the whole group of rows that share its name.

import { db } from '@/lib/db';
import { schools } from '@/lib/db/schema';
import { inArray } from 'drizzle-orm';

/** Rows of the same school (across olympiads) share this key. */
export function schoolKey(name: string | null | undefined): string {
  return (name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

type MembershipLike = { schoolId: string | null; portalId: string };

export type ActiveSchool<M extends MembershipLike> = {
  /** The educator's memberships at the active school, across its olympiads. */
  memberships: M[];
  /** Every `schools` row of the active school (one per olympiad, usually). */
  schoolIds: string[];
  portalIds: string[];
  /** One `schools` row per olympiad, for actions that need a single row. */
  schoolByPortal: Map<string, string>;
  /** Display name and a stable id for the picker/cookie. */
  name: string | null;
  primarySchoolId: string;
};

/**
 * Resolves the active school from the educator's memberships and the
 * `active_school_id` cookie. The cookie may hold any of the school's rows; a
 * missing or stale cookie falls back to the educator's first school.
 */
export async function resolveActiveSchool<M extends MembershipLike>(
  educatorMemberships: M[],
  cookieSchoolId: string | null | undefined
): Promise<ActiveSchool<M> | null> {
  const withSchool = educatorMemberships.filter(
    (m): m is M & { schoolId: string } => m.schoolId !== null
  );
  if (withSchool.length === 0) return null;

  const rows = await db
    .select({ id: schools.id, name: schools.name })
    .from(schools)
    .where(inArray(schools.id, [...new Set(withSchool.map((m) => m.schoolId))]));
  const keyById = new Map(rows.map((r) => [r.id, schoolKey(r.name)]));
  const nameById = new Map(rows.map((r) => [r.id, r.name]));

  // A school without a row to read a name from is only ever itself
  const keyOf = (id: string) => keyById.get(id) ?? `id:${id}`;

  const cookieMatch = cookieSchoolId
    ? withSchool.find((m) => m.schoolId === cookieSchoolId)
    : undefined;
  const anchor = cookieMatch ?? withSchool[0];
  const activeKey = keyOf(anchor.schoolId);

  const group = withSchool.filter((m) => keyOf(m.schoolId) === activeKey);
  const schoolIds = [...new Set(group.map((m) => m.schoolId))];
  const schoolByPortal = new Map<string, string>();
  for (const m of group) {
    if (!schoolByPortal.has(m.portalId)) schoolByPortal.set(m.portalId, m.schoolId);
  }

  return {
    memberships: group,
    schoolIds,
    portalIds: [...new Set(group.map((m) => m.portalId))],
    schoolByPortal,
    name: nameById.get(schoolIds[0]) ?? null,
    primarySchoolId: schoolIds[0],
  };
}

/**
 * One entry per school for the picker. Each carries the id of its first row
 * (used as the cookie value; any row of the school resolves to the same one).
 */
export function uniqueSchoolsByName(
  rows: { schoolId: string | null; schoolName: string | null }[]
): { schoolId: string; schoolName: string | null }[] {
  const seen = new Map<string, { schoolId: string; schoolName: string | null }>();
  for (const r of rows) {
    if (!r.schoolId) continue;
    const key = r.schoolName ? schoolKey(r.schoolName) : `id:${r.schoolId}`;
    if (!seen.has(key)) seen.set(key, { schoolId: r.schoolId, schoolName: r.schoolName });
  }
  return [...seen.values()];
}

/** Maps the cookie's school id onto the picker entry that represents it. */
export function pickerIdFor(
  entries: { schoolId: string; schoolName: string | null }[],
  allRows: { schoolId: string | null; schoolName: string | null }[],
  cookieSchoolId: string | null | undefined
): string | undefined {
  if (!cookieSchoolId) return undefined;
  const row = allRows.find((r) => r.schoolId === cookieSchoolId);
  if (!row) return undefined;
  const key = row.schoolName ? schoolKey(row.schoolName) : `id:${row.schoolId}`;
  return entries.find(
    (e) => (e.schoolName ? schoolKey(e.schoolName) : `id:${e.schoolId}`) === key
  )?.schoolId;
}
