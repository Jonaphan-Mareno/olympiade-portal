import { describe, it, expect } from 'vitest';
import { deriveRoundState } from '@/domain/rounds/round-state-machine';

const NOW = new Date('2026-09-14T12:00:00Z');

function makeRound(
  overrides: Partial<{
    opensAt: Date;
    closesAt: Date;
    resultsPublishedAt: Date | null;
  }> = {}
) {
  return {
    opensAt: new Date('2026-09-21T09:00:00Z'),
    closesAt: new Date('2026-09-28T17:00:00Z'),
    resultsPublishedAt: null,
    ...overrides,
  };
}

describe('deriveRoundState', () => {
  it('returns scheduled before opensAt', () => {
    expect(deriveRoundState(makeRound(), NOW)).toBe('scheduled');
  });

  it('returns open between opensAt and closesAt', () => {
    const round = makeRound({
      opensAt: new Date('2026-09-13T09:00:00Z'),
    });
    expect(deriveRoundState(round, NOW)).toBe('open');
  });

  it('returns closed after closesAt when results are not published', () => {
    const round = makeRound({
      opensAt: new Date('2026-09-01T09:00:00Z'),
      closesAt: new Date('2026-09-10T17:00:00Z'),
    });
    expect(deriveRoundState(round, NOW)).toBe('closed');
  });

  it('returns released once resultsPublishedAt is set, even before closesAt', () => {
    const round = makeRound({
      resultsPublishedAt: new Date('2026-09-12T10:00:00Z'),
    });
    expect(deriveRoundState(round, NOW)).toBe('released');
  });

  it('released takes precedence over closed', () => {
    const round = makeRound({
      opensAt: new Date('2026-09-01T09:00:00Z'),
      closesAt: new Date('2026-09-10T17:00:00Z'),
      resultsPublishedAt: new Date('2026-09-11T10:00:00Z'),
    });
    expect(deriveRoundState(round, NOW)).toBe('released');
  });

  it('treats the exact opensAt instant as open', () => {
    const round = makeRound({ opensAt: NOW });
    expect(deriveRoundState(round, NOW)).toBe('open');
  });

  it('treats the exact closesAt instant as closed', () => {
    const round = makeRound({
      opensAt: new Date('2026-09-01T09:00:00Z'),
      closesAt: NOW,
    });
    expect(deriveRoundState(round, NOW)).toBe('closed');
  });
});
