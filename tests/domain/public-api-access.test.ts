import { describe, it, expect } from 'vitest';
import {
  areResultsPublished,
  isSemiPublicAvailable,
} from '@/domain/public-api/access';

const NOW = new Date('2026-09-14T07:00:00Z');

function round(
  overrides: Partial<{
    opensAt: Date;
    closesAt: Date;
    resultsPublishedAt: Date | null;
  }> = {}
) {
  return {
    opensAt: new Date('2026-09-01T09:00:00Z'),
    closesAt: new Date('2026-09-10T17:00:00Z'),
    resultsPublishedAt: null,
    ...overrides,
  };
}

describe('isSemiPublicAvailable', () => {
  it('hides a scheduled round', () => {
    expect(
      isSemiPublicAvailable(
        round({
          opensAt: new Date('2026-09-20T09:00:00Z'),
          closesAt: new Date('2026-09-25T17:00:00Z'),
        }),
        NOW
      )
    ).toBe(false);
  });

  it('hides an open round', () => {
    expect(
      isSemiPublicAvailable(
        round({ closesAt: new Date('2026-09-18T17:00:00Z') }),
        NOW
      )
    ).toBe(false);
  });

  it('reveals a closed round', () => {
    expect(isSemiPublicAvailable(round(), NOW)).toBe(true);
  });

  it('keeps a released round available', () => {
    expect(
      isSemiPublicAvailable(
        round({ resultsPublishedAt: new Date('2026-09-12T10:00:00Z') }),
        NOW
      )
    ).toBe(true);
  });
});

describe('areResultsPublished', () => {
  it('is false until the organiser publishes the results', () => {
    expect(areResultsPublished(round())).toBe(false);
  });

  it('is true once results_published_at is set', () => {
    expect(
      areResultsPublished(
        round({ resultsPublishedAt: new Date('2026-09-12T10:00:00Z') })
      )
    ).toBe(true);
  });
});
