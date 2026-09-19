import { describe, it, expect, vi } from 'vitest';
import {
  searchUniversities,
  UniversitiesApiError,
} from '@/lib/schools/universities';

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as unknown as Response;
}

describe('searchUniversities', () => {
  it('returns an empty array for queries shorter than 2 characters', async () => {
    const fetchImpl = vi.fn();
    expect(await searchUniversities('a', fetchImpl)).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('queries hipolabs with the encoded name and maps the payload', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse([
          {
            name: 'University of Cape Town',
            country: 'South Africa',
            'state-province': 'Western Cape Province',
            domains: ['uct.ac.za', 'myuct.ac.za'],
          },
          {
            name: 'Cape Fear Community College',
            country: 'United States',
            domains: ['cfcc.edu'],
          },
        ])
      );

    const results = await searchUniversities('cape town', fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      // http, not https: the API only listens on port 80. Spaces encode
      // as "+" per the API's documented curl format.
      'http://universities.hipolabs.com/search?name=cape+town',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(results).toEqual([
      {
        name: 'University of Cape Town',
        type: 'university',
        country: 'South Africa',
        externalId: 'uct.ac.za', // first domain
      },
      {
        name: 'Cape Fear Community College',
        type: 'university',
        country: 'United States',
        externalId: 'cfcc.edu',
      },
    ]);
  });

  it('ranks South African universities first', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse([
        { name: 'Zzz University', country: 'United States', domains: [] },
        { name: 'University of the Witwatersrand', country: 'South Africa' },
        { name: 'Aaa College', country: 'United States', domains: [] },
        { name: 'Stellenbosch University', country: 'South Africa' },
      ])
    );

    const results = await searchUniversities('university', fetchImpl);

    expect(results.map((r) => r.name)).toEqual([
      'Stellenbosch University',
      'University of the Witwatersrand',
      'Aaa College',
      'Zzz University',
    ]);
  });

  it('skips entries without a name and tolerates missing fields', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse([{ country: 'South Africa' }, { name: '  Wits  ' }])
    );

    const results = await searchUniversities('wits', fetchImpl);

    expect(results).toEqual([
      {
        name: 'Wits', // trimmed
        type: 'university',
        country: null,
        externalId: null,
      },
    ]);
  });

  it('wraps upstream HTTP errors in UniversitiesApiError', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 503));

    await expect(searchUniversities('cape', fetchImpl)).rejects.toBeInstanceOf(
      UniversitiesApiError
    );
  });

  it('wraps network failures in UniversitiesApiError', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNRESET'));

    await expect(searchUniversities('cape', fetchImpl)).rejects.toBeInstanceOf(
      UniversitiesApiError
    );
  });

  it('wraps non-array payloads in UniversitiesApiError', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));

    await expect(searchUniversities('cape', fetchImpl)).rejects.toBeInstanceOf(
      UniversitiesApiError
    );
  });
});
