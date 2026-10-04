import { describe, it, expect } from 'vitest';
import {
  getMarkingDeadline,
  getMarkingWindowStatus,
} from '@/domain/rounds/paper-marking';

const round = {
  opensAt: new Date('2026-09-10T08:00:00Z'),
  closesAt: new Date('2026-09-10T12:00:00Z'),
  markingClosesAt: null as Date | null,
  resultsPublishedAt: null as Date | null,
};

describe('paper marking window', () => {
  it('defaults the deadline to 24 hours after the round closes', () => {
    expect(getMarkingDeadline(round).toISOString()).toBe('2026-09-11T12:00:00.000Z');
  });

  it("uses the organiser's deadline when set", () => {
    const deadline = new Date('2026-09-17T15:00:00Z');
    expect(getMarkingDeadline({ ...round, markingClosesAt: deadline })).toEqual(deadline);
    expect(
      getMarkingWindowStatus(
        { ...round, markingClosesAt: deadline },
        new Date('2026-09-15T09:00:00Z')
      ).status
    ).toBe('open');
  });

  it('is closed before the round opens and after the deadline', () => {
    expect(getMarkingWindowStatus(round, new Date('2026-09-09T08:00:00Z')).status).toBe('not_open');
    expect(getMarkingWindowStatus(round, new Date('2026-09-12T08:00:00Z')).status).toBe('closed');
  });

  it('locks marks once results are published', () => {
    const published = { ...round, resultsPublishedAt: new Date('2026-09-10T20:00:00Z') };
    expect(getMarkingWindowStatus(published, new Date('2026-09-10T21:00:00Z')).status).toBe('closed');
  });
});
