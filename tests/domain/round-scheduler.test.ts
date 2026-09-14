import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sweep } from '@/domain/rounds/round-scheduler';

// sweep() queries rounds+portals once, then hands each round to the
// automation engine (mocked here) — the engine's behaviour is covered by
// tests/domain/automation-engine.test.ts.
const state = vi.hoisted(() => ({
  rounds: [] as any[],
}));

vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => Promise.resolve(state.rounds),
        }),
      }),
    }),
  },
}));

vi.mock('@/domain/notifications/automation-engine', () => ({
  sendRoundOpeningReminders: vi.fn(async () => ({
    sent: 1,
    skipped: 0,
    failed: 0,
  })),
  sendRoundClosingReminders: vi.fn(async () => ({
    sent: 1,
    skipped: 0,
    failed: 0,
  })),
  sendSubmissionOverdueFollowups: vi.fn(async () => ({
    sent: 1,
    skipped: 0,
    failed: 0,
  })),
  sendResultsPublishedNotifications: vi.fn(async () => ({
    sent: 2,
    skipped: 0,
    failed: 0,
  })),
}));

import {
  sendRoundOpeningReminders,
  sendRoundClosingReminders,
  sendSubmissionOverdueFollowups,
  sendResultsPublishedNotifications,
} from '@/domain/notifications/automation-engine';

const NOW = new Date('2026-09-14T07:00:00Z');

function makeRound(
  overrides: Partial<{
    id: string;
    name: string;
    portalId: string;
    opensAt: Date;
    closesAt: Date;
    resultsPublishedAt: Date | null;
  }> = {}
) {
  return {
    id: 'round-1',
    portalId: 'portal-1',
    portalName: 'Maths Olympiad',
    name: 'Round 1',
    orderIndex: 1,
    deliveryMethod: 'paper',
    opensAt: new Date('2026-09-01T09:00:00Z'),
    closesAt: new Date('2026-09-10T17:00:00Z'),
    qualifyingThreshold: '30',
    resultsPublishedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.rounds = [];
  process.env.NEXT_PUBLIC_BASE_URL = 'http://test.example';
  delete process.env.REMINDER_OPENING_WINDOW_DAYS;
  delete process.env.REMINDER_OPENING_WINDOW_HOURS;
  delete process.env.REMINDER_CLOSING_WINDOW_DAYS;
  delete process.env.REMINDER_CLOSING_WINDOW_HOURS;
  delete process.env.REMINDER_OVERDUE_AFTER_DAYS;
  delete process.env.REMINDER_RESULTS_CATCHUP_DAYS;
});

describe('sweep', () => {
  it('sends opening reminders for rounds opening within the window', async () => {
    state.rounds = [makeRound({ opensAt: new Date('2026-09-18T09:00:00Z') })];

    const result = await sweep(NOW);

    expect(result.roundCount).toBe(1);
    expect(result.outcomes[0].state).toBe('scheduled');
    expect(sendRoundOpeningReminders).toHaveBeenCalledTimes(1);
    expect(sendRoundClosingReminders).not.toHaveBeenCalled();
    expect(sendSubmissionOverdueFollowups).not.toHaveBeenCalled();
  });

  it('ignores rounds opening further away than the window', async () => {
    state.rounds = [makeRound({ opensAt: new Date('2026-10-30T09:00:00Z') })];

    const result = await sweep(NOW);

    expect(result.outcomes[0].triggered).toEqual([]);
    expect(sendRoundOpeningReminders).not.toHaveBeenCalled();
  });

  it('sends closing reminders for open rounds closing within the window', async () => {
    state.rounds = [
      makeRound({
        opensAt: new Date('2026-09-10T09:00:00Z'),
        closesAt: new Date('2026-09-16T17:00:00Z'),
      }),
    ];

    const result = await sweep(NOW);

    expect(result.outcomes[0].state).toBe('open');
    expect(sendRoundClosingReminders).toHaveBeenCalledTimes(1);
    expect(sendRoundOpeningReminders).not.toHaveBeenCalled();
  });

  it('sends closing reminders inside an hours-only closing window', async () => {
    process.env.REMINDER_CLOSING_WINDOW_DAYS = '0';
    process.env.REMINDER_CLOSING_WINDOW_HOURS = '1';
    // Closes 30 minutes from now — inside the one-hour window
    state.rounds = [
      makeRound({
        opensAt: new Date('2026-09-10T09:00:00Z'),
        closesAt: new Date('2026-09-14T07:30:00Z'),
      }),
    ];

    const result = await sweep(NOW);

    expect(result.outcomes[0].state).toBe('open');
    expect(sendRoundClosingReminders).toHaveBeenCalledTimes(1);
  });

  it('waits until an hours-only closing window starts', async () => {
    process.env.REMINDER_CLOSING_WINDOW_DAYS = '0';
    process.env.REMINDER_CLOSING_WINDOW_HOURS = '1';
    // Closes 2 hours from now — outside the one-hour window
    state.rounds = [
      makeRound({
        opensAt: new Date('2026-09-10T09:00:00Z'),
        closesAt: new Date('2026-09-14T09:00:00Z'),
      }),
    ];

    const result = await sweep(NOW);

    expect(result.outcomes[0].state).toBe('open');
    expect(result.outcomes[0].triggered).toEqual([]);
    expect(sendRoundClosingReminders).not.toHaveBeenCalled();
  });

  it('adds days and hours together for the closing window', async () => {
    process.env.REMINDER_CLOSING_WINDOW_DAYS = '1';
    process.env.REMINDER_CLOSING_WINDOW_HOURS = '12';
    // Closes 30 hours from now — inside the 36-hour (1 day + 12 hours) window
    state.rounds = [
      makeRound({
        opensAt: new Date('2026-09-10T09:00:00Z'),
        closesAt: new Date('2026-09-15T13:00:00Z'),
      }),
    ];

    const result = await sweep(NOW);

    expect(result.outcomes[0].state).toBe('open');
    expect(sendRoundClosingReminders).toHaveBeenCalledTimes(1);
  });

  it('sends opening reminders inside an hours-only opening window', async () => {
    process.env.REMINDER_OPENING_WINDOW_DAYS = '0';
    process.env.REMINDER_OPENING_WINDOW_HOURS = '1';
    // Opens 45 minutes from now — inside the one-hour window
    state.rounds = [
      makeRound({
        opensAt: new Date('2026-09-14T07:45:00Z'),
        closesAt: new Date('2026-09-21T17:00:00Z'),
      }),
    ];

    const result = await sweep(NOW);

    expect(result.outcomes[0].state).toBe('scheduled');
    expect(sendRoundOpeningReminders).toHaveBeenCalledTimes(1);
  });

  it('sends overdue follow-ups for closed rounds after the grace period', async () => {
    state.rounds = [
      makeRound({
        opensAt: new Date('2026-09-01T09:00:00Z'),
        closesAt: new Date('2026-09-10T17:00:00Z'),
      }),
    ];

    const result = await sweep(NOW);

    expect(result.outcomes[0].state).toBe('closed');
    expect(sendSubmissionOverdueFollowups).toHaveBeenCalledTimes(1);
  });

  it('waits for the grace period before chasing overdue submissions', async () => {
    // Closed only yesterday (default grace: 2 days)
    state.rounds = [
      makeRound({
        opensAt: new Date('2026-09-11T09:00:00Z'),
        closesAt: new Date('2026-09-13T17:00:00Z'),
      }),
    ];

    const result = await sweep(NOW);

    expect(result.outcomes[0].state).toBe('closed');
    expect(result.outcomes[0].triggered).toEqual([]);
    expect(sendSubmissionOverdueFollowups).not.toHaveBeenCalled();
  });

  it('catches up results notifications for recently released rounds', async () => {
    state.rounds = [
      makeRound({
        resultsPublishedAt: new Date('2026-09-12T10:00:00Z'),
      }),
    ];

    const result = await sweep(NOW);

    expect(result.outcomes[0].state).toBe('released');
    expect(sendResultsPublishedNotifications).toHaveBeenCalledTimes(1);
  });

  it('does not keep re-sending results notifications forever', async () => {
    // Published 60 days ago — beyond the 14-day catch-up window
    state.rounds = [
      makeRound({
        resultsPublishedAt: new Date('2026-07-15T10:00:00Z'),
      }),
    ];

    const result = await sweep(NOW);

    expect(result.outcomes[0].state).toBe('released');
    expect(result.outcomes[0].triggered).toEqual([]);
    expect(sendResultsPublishedNotifications).not.toHaveBeenCalled();
  });

  it('honours custom reminder windows from the environment', async () => {
    process.env.REMINDER_OPENING_WINDOW_DAYS = '30';
    // 20 days until open — outside the default 7, inside the custom 30
    state.rounds = [makeRound({ opensAt: new Date('2026-10-04T09:00:00Z') })];

    await sweep(NOW);

    expect(sendRoundOpeningReminders).toHaveBeenCalledTimes(1);

    delete process.env.REMINDER_OPENING_WINDOW_DAYS;
  });

  it('isolates failures of a single round from the rest of the sweep', async () => {
    (sendSubmissionOverdueFollowups as any).mockRejectedValueOnce(
      new Error('engine blew up')
    );
    state.rounds = [makeRound({ id: 'round-1' }), makeRound({ id: 'round-2' })];

    const result = await sweep(NOW);

    // Both rounds attempted; the first failed, the second still went out
    expect(result.outcomes[0].summary.failed).toBe(1);
    expect(result.outcomes[1].summary.sent).toBe(1);
    expect(sendSubmissionOverdueFollowups).toHaveBeenCalledTimes(2);
  });

  it('returns an empty result when there are no rounds', async () => {
    const result = await sweep(NOW);

    expect(result).toEqual({
      ranAt: NOW.toISOString(),
      portalCount: 0,
      roundCount: 0,
      outcomes: [],
    });
  });
});
