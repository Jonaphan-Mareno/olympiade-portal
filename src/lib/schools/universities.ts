import type { SchoolSuggestion } from './types';

// http://universities.hipolabs.com/search — free, no key, no rate limit.
// Called server-side only, so the suggest endpoint can stay authenticated
// and the browser never depends on the upstream API being reachable.
// NOTE: must stay http:// — the host refuses connections on port 443, so
// https:// fails with ECONNREFUSED.
const UNIVERSITIES_API_URL = 'http://universities.hipolabs.com/search';
const TIMEOUT_MS = 10_000;

type HipolabsUniversity = {
  name?: string;
  country?: string;
  alpha_two_code?: string;
  domains?: string[];
};

// Thrown for any upstream failure (network, timeout, non-2xx, bad payload)
// so the suggest endpoint can translate it into a 502 instead of silently
// claiming there are no matches.
export class UniversitiesApiError extends Error {}

export async function searchUniversities(
  query: string,
  fetchImpl: typeof fetch = fetch
): Promise<SchoolSuggestion[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  let data: HipolabsUniversity[];
  try {
    // URLSearchParams encodes spaces as "+", matching the API's documented
    // curl format: ?name=university+of+pr
    const res = await fetchImpl(
      `${UNIVERSITIES_API_URL}?${new URLSearchParams({ name: q })}`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    data = await res.json();
  } catch (err) {
    throw new UniversitiesApiError(
      `Universities API request failed: ${err instanceof Error ? err.message : err}`
    );
  }

  if (!Array.isArray(data)) {
    throw new UniversitiesApiError('Universities API returned a non-array payload');
  }

  const suggestions: SchoolSuggestion[] = data
    .filter((u): u is HipolabsUniversity & { name: string } => !!u?.name)
    .map((u) => ({
      name: u.name.trim(),
      type: 'university' as const,
      country: u.country ?? null,
      externalId: u.domains?.[0] ?? null,
    }));

  // South African universities first: the portal is SA-run, and locals
  // shouldn't have to scroll through US community colleges to find UCT.
  suggestions.sort((a, b) => {
    const aZa = a.country === 'South Africa' ? 0 : 1;
    const bZa = b.country === 'South Africa' ? 0 : 1;
    if (aZa !== bZa) return aZa - bZa;
    return a.name.localeCompare(b.name);
  });

  return suggestions.slice(0, 20);
}
