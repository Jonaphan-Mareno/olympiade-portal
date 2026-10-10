import { describe, it, expect, vi, beforeEach } from 'vitest';

// The same school invited to two olympiads is two `schools` rows with the same
// name. The educator should see it once, with the data of both olympiads.
const state = vi.hoisted(() => ({ schoolRows: [] as { id: string; name: string }[] }));

vi.mock('@/lib/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => Promise.resolve(state.schoolRows) }) }) },
}));

import {
  pickerIdFor,
  resolveActiveSchool,
  schoolKey,
  uniqueSchoolsByName,
} from '@/domain/educator/active-school';

const memberships = [
  { schoolId: 'wits-a', portalId: 'portal-a' },
  { schoolId: 'wits-b', portalId: 'portal-b' },
  { schoolId: 'other', portalId: 'portal-a' },
];

beforeEach(() => {
  state.schoolRows = [
    { id: 'wits-a', name: 'Wits  High School' },
    { id: 'wits-b', name: 'wits high school ' },
    { id: 'other', name: 'Other School' },
  ];
});

describe('school picker', () => {
  it('lists a school once however many olympiads it is in', () => {
    const rows = [
      { schoolId: 'wits-a', schoolName: 'Wits High School' },
      { schoolId: 'wits-b', schoolName: 'Wits High School' },
      { schoolId: 'other', schoolName: 'Other School' },
    ];
    expect(uniqueSchoolsByName(rows)).toEqual([
      { schoolId: 'wits-a', schoolName: 'Wits High School' },
      { schoolId: 'other', schoolName: 'Other School' },
    ]);
  });

  it('maps any row of a school onto its picker entry', () => {
    const rows = [
      { schoolId: 'wits-a', schoolName: 'Wits High School' },
      { schoolId: 'wits-b', schoolName: 'Wits High School' },
    ];
    const entries = uniqueSchoolsByName(rows);
    expect(pickerIdFor(entries, rows, 'wits-b')).toBe('wits-a');
    expect(pickerIdFor(entries, rows, 'gone')).toBeUndefined();
    expect(pickerIdFor(entries, rows, undefined)).toBeUndefined();
  });

  it('ignores case and spacing when comparing names', () => {
    expect(schoolKey('  Wits   High School ')).toBe(schoolKey('wits high school'));
  });
});

describe('resolveActiveSchool', () => {
  it('combines every olympiad of the selected school', async () => {
    const res = await resolveActiveSchool(memberships, 'wits-b');
    expect(res?.schoolIds).toEqual(['wits-a', 'wits-b']);
    expect(res?.portalIds).toEqual(['portal-a', 'portal-b']);
    expect(res?.schoolByPortal.get('portal-b')).toBe('wits-b');
    expect(res?.memberships).toHaveLength(2);
  });

  it('keeps different schools apart', async () => {
    const res = await resolveActiveSchool(memberships, 'other');
    expect(res?.schoolIds).toEqual(['other']);
    expect(res?.portalIds).toEqual(['portal-a']);
  });

  it('falls back to the first school for a missing or stale cookie', async () => {
    expect((await resolveActiveSchool(memberships, undefined))?.schoolIds).toEqual(['wits-a', 'wits-b']);
    expect((await resolveActiveSchool(memberships, 'deleted'))?.schoolIds).toEqual(['wits-a', 'wits-b']);
  });

  it('returns null when the educator has no school', async () => {
    expect(await resolveActiveSchool([{ schoolId: null, portalId: 'p' }], undefined)).toBeNull();
    expect(await resolveActiveSchool([], undefined)).toBeNull();
  });
});
