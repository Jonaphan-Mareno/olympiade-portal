import { describe, it, expect, vi } from 'vitest';
import { searchHighSchools } from '@/lib/schools/high-schools';
import type { HighSchoolRecord } from '@/lib/schools/types';

// The search is a pure function over records, so fixture data is enough -
// no need for the ~8800-record snapshot in these tests. The module's JSON
// import is stubbed so the suite also runs before the snapshot exists.
vi.mock('@/data/south-african-high-schools.json', () => ({
  default: { source: 'fixture', fetchedAt: '', total: 0, schools: [] },
}));
const RECORDS: HighSchoolRecord[] = [
  {
    id: 1,
    natEmis: '700401012',
    name: "ST. PATRICK'S COLLEGE",
    province: 'Gauteng',
    town: 'PRETORIA',
    phase: 'SECONDARY SCHOOL',
  },
  {
    id: 2,
    natEmis: '200200001',
    name: 'A M S SITYANA SENIOR SECONDARY SCHOOL',
    province: 'Eastern Cape',
    town: 'KING WILLIAMS TOWN',
    phase: 'SECONDARY SCHOOL',
  },
  {
    id: 3,
    natEmis: '300016302',
    name: 'PATRICIA PRIMARY SCHOOL',
    province: 'Northern Cape',
    town: 'KIMBERLEY',
    phase: 'PRIMARY SCHOOL',
  },
  {
    id: 4,
    natEmis: null,
    name: 'RONDEBOSCH BOYS HIGH SCHOOL',
    province: 'Western Cape',
    town: 'CAPE TOWN',
    phase: 'SECONDARY SCHOOL',
  },
];

describe('searchHighSchools', () => {
  it('matches every whitespace-separated token anywhere in name, town or province', () => {
    const results = searchHighSchools(RECORDS, 'pretoria st');

    expect(results.map((r) => r.name)).toEqual(["ST. PATRICK'S COLLEGE"]);
  });

  it('matches on town and province, not just the name', () => {
    const results = searchHighSchools(RECORDS, 'kimberley');

    expect(results.map((r) => r.name)).toEqual(['PATRICIA PRIMARY SCHOOL']);
  });

  it('ignores punctuation differences between query and names', () => {
    // "st patricks" must match "ST. PATRICK'S COLLEGE"
    const results = searchHighSchools(RECORDS, "st patrick's");
    expect(results.map((r) => r.name)).toEqual(["ST. PATRICK'S COLLEGE"]);

    const dotted = searchHighSchools(RECORDS, 'st patricks');
    expect(dotted.map((r) => r.name)).toEqual(["ST. PATRICK'S COLLEGE"]);
  });

  it('returns nothing when a token does not match anywhere', () => {
    expect(searchHighSchools(RECORDS, 'sityana bloemfontein')).toEqual([]);
  });

  it('folds accents so Afrikaans names are searchable without diacritics', () => {
    const records: HighSchoolRecord[] = [
      {
        id: 1,
        natEmis: null,
        name: 'HOËR SKOOL DF MALAN',
        province: 'North West',
        town: null,
        phase: null,
      },
    ];

    expect(searchHighSchools(records, 'hoer skool')).toHaveLength(1);
    expect(searchHighSchools(records, 'hoër')).toHaveLength(1);
  });

  it('returns an empty array for short or blank queries', () => {
    expect(searchHighSchools(RECORDS, '')).toEqual([]);
    expect(searchHighSchools(RECORDS, '   ')).toEqual([]);
    expect(searchHighSchools(RECORDS, 'a')).toEqual([]);
  });

  it('ranks name-prefix matches above substring matches, then alphabetically', () => {
    const records: HighSchoolRecord[] = [
      {
        id: 1,
        natEmis: null,
        name: 'ZEBEDIELA HIGH SCHOOL',
        province: 'Limpopo',
        town: null,
        phase: null,
      },
      {
        id: 2,
        natEmis: null,
        name: 'BENDER HIGH SCHOOL',
        province: 'Limpopo',
        town: 'ZEBEDIELA',
        phase: null,
      },
      {
        id: 3,
        natEmis: null,
        name: 'ABBA HIGH SCHOOL',
        province: 'Limpopo',
        town: null,
        phase: null,
      },
    ];

    const results = searchHighSchools(records, 'zebediela high');

    // ZEBEDIELA HIGH (name starts with the token) before BENDER (town match)
    expect(results.map((r) => r.name)).toEqual([
      'ZEBEDIELA HIGH SCHOOL',
      'BENDER HIGH SCHOOL',
    ]);
  });

  it('caps the number of results', () => {
    const many: HighSchoolRecord[] = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      natEmis: String(i),
      name: `MATCHING SCHOOL ${i}`,
      province: 'Gauteng',
      town: 'PRETORIA',
      phase: 'SECONDARY SCHOOL',
    }));

    expect(searchHighSchools(many, 'matching', 10)).toHaveLength(10);
    expect(searchHighSchools(many, 'matching')).toHaveLength(20); // default cap
  });

  it('maps records to suggestions with type, location and external id', () => {
    const [result] = searchHighSchools(RECORDS, 'rondebosch');

    expect(result).toEqual({
      name: 'RONDEBOSCH BOYS HIGH SCHOOL',
      type: 'high_school',
      province: 'Western Cape',
      town: 'CAPE TOWN',
      externalId: null,
    });
  });
});
