import directory from '@/data/south-african-high-schools.json';
import type { HighSchoolRecord, SchoolSuggestion } from './types';

// The full South African high-school directory, snapshotted to
// src/data/south-african-high-schools.json by `npm run fetch:schools`.
// Schools are picked from this local snapshot instead of calling
// api.labs.org.za per user keystroke: that API is rate limited to ~20
// requests per minute, so it can only ever be walked offline in bulk.
export function loadHighSchools(): HighSchoolRecord[] {
  return directory.schools;
}

// Lowercase, fold accents ("HOËR" -> "hoer" so it stays typeable) and
// drop punctuation entirely instead of turning it into word boundaries,
// so that "St. Patrick's" matches the query "st patricks".
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toSuggestion(record: HighSchoolRecord): SchoolSuggestion {
  return {
    name: record.name,
    type: 'high_school',
    province: record.province,
    town: record.town,
    externalId: record.natEmis,
  };
}

// Pure search over a set of high-school records: every whitespace-separated
// query token must appear somewhere in the school's name, town or province.
// Pure (records are a parameter) so it can be unit tested with fixtures.
export function searchHighSchools(
  records: HighSchoolRecord[],
  query: string,
  limit = 20
): SchoolSuggestion[] {
  const normalizedQuery = normalize(query);
  // One character matches almost every name as a substring, so search
  // starts at two characters (the API route applies the same floor).
  if (normalizedQuery.length < 2) return [];

  const tokens = normalizedQuery.split(' ').filter(Boolean);
  if (tokens.length === 0) return [];

  const matches: { suggestion: SchoolSuggestion; haystack: string }[] = [];
  for (const record of records) {
    const haystack = normalize(
      [record.name, record.town, record.province].filter(Boolean).join(' ')
    );
    if (tokens.every((token) => haystack.includes(token))) {
      matches.push({ suggestion: toSuggestion(record), haystack });
    }
  }

  // Schools whose name starts with the first token rank above plain
  // substring matches, then alphabetically.
  const firstToken = tokens[0];
  matches.sort((a, b) => {
    const aStarts = a.haystack.startsWith(firstToken) ? 0 : 1;
    const bStarts = b.haystack.startsWith(firstToken) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    return a.suggestion.name.localeCompare(b.suggestion.name);
  });

  return matches.slice(0, limit).map((m) => m.suggestion);
}
