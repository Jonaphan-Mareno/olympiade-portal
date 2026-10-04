import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Round } from '@/domain/rounds/round.types';

vi.mock('@/lib/db', () => ({ db: {} }));

vi.mock('@/domain/notifications/automation-engine', () => ({
  planRoundOpeningReminders: vi.fn(async () => [{ kind: 'round_opening_reminder' }]),
  planRoundClosingReminders: vi.fn(async () => [{ kind: 'round_closing_reminder' }]),
  planSubmissionOverdueFollowups: vi.fn(async () => []),
  planResultsPublishedNotifications: vi.fn(async () => []),
  dispatchPlanned: vi.fn(async (emails: any[]) => ({
    sent: emails.length,
    skipped: 0,
    failed: 0,
  })),
}));

import {
  describeOffset,
  evaluateRuleTiming,
  parseConditions,
  runDueRules,
  type AutomationRuleConfig,
} from '@/domain/notifications/automation-rules';
import {
  dispatchPlanned,
  planRoundClosingReminders,
} from '@/domain/notifications/automation-engine';

const HOUR = 60;
const DAY = 24 * HOUR;

const round: Round = {
  id: 'round-1',
  portalId: 'portal-1',
  portalName: 'Maths Olympiad',
  name: 'Round 1',
  orderIndex: 1,
  deliveryMethod: 'online',
  opensAt: new Date('2026-09-10T09:00:00Z'),
  closesAt: new Date('2026-09-20T17:00:00Z'),
  qualifyingThreshold: null,
  resultsPublishedAt: null,
};

function rule(over: Partial<AutomationRuleConfig> = {}): AutomationRuleConfig {
  return {
    id: 'rule-1',
    portalId: 'portal-1',
    name: 'Rule',
    triggerType: 'round_closing',
    triggerOffsetMinutes: -3 * DAY,
    conditions: { roundIds: null, missingSubmissionsOnly: false, includeEntrants: true },
    subject: '',
    note: '',
    isActive: true,
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('evaluateRuleTiming', () => {
  it('waits until the configured offset before the milestone', () => {
    const t = evaluateRuleTiming(rule(), round, new Date('2026-09-16T12:00:00Z'));
    expect(t.status).toBe('waiting');
    expect(t.fireAt?.toISOString()).toBe('2026-09-17T17:00:00.000Z');
  });

  it('is due once the send time has passed while the round is open', () => {
    const t = evaluateRuleTiming(rule(), round, new Date('2026-09-18T12:00:00Z'));
    expect(t.status).toBe('due');
  });

  it('honours hour-level offsets', () => {
    const r = rule({ triggerOffsetMinutes: -1 * HOUR });
    expect(
      evaluateRuleTiming(r, round, new Date('2026-09-20T15:30:00Z')).status
    ).toBe('waiting');
    expect(
      evaluateRuleTiming(r, round, new Date('2026-09-20T16:30:00Z')).status
    ).toBe('due');
  });

  it('never sends a closing reminder after the round has closed', () => {
    const t = evaluateRuleTiming(rule(), round, new Date('2026-09-21T09:00:00Z'));
    expect(t.status).toBe('missed');
  });

  it('chases missing submissions after close, but not once results are out', () => {
    const r = rule({ triggerType: 'submission_overdue', triggerOffsetMinutes: 2 * DAY });
    expect(
      evaluateRuleTiming(r, round, new Date('2026-09-23T09:00:00Z')).status
    ).toBe('due');
    expect(
      evaluateRuleTiming(
        r,
        { ...round, resultsPublishedAt: new Date('2026-09-22T09:00:00Z') },
        new Date('2026-09-23T09:00:00Z')
      ).status
    ).toBe('missed');
  });

  it('fires results rules relative to publication, and not before it', () => {
    const r = rule({ triggerType: 'results_published', triggerOffsetMinutes: 0 });
    expect(
      evaluateRuleTiming(r, round, new Date('2026-09-25T09:00:00Z')).status
    ).toBe('not_applicable');

    const released = { ...round, resultsPublishedAt: new Date('2026-09-25T09:00:00Z') };
    expect(
      evaluateRuleTiming(r, released, new Date('2026-09-25T09:00:00Z')).status
    ).toBe('due');
  });

  it('stops acting once the send time is more than a week old', () => {
    const r = rule({ triggerType: 'results_published', triggerOffsetMinutes: 0 });
    const released = { ...round, resultsPublishedAt: new Date('2026-09-01T09:00:00Z') };
    expect(
      evaluateRuleTiming(r, released, new Date('2026-09-20T09:00:00Z')).status
    ).toBe('missed');
  });

  it('only applies to the rounds the rule is limited to', () => {
    const r = rule({
      conditions: { roundIds: ['round-2'], missingSubmissionsOnly: false, includeEntrants: true },
    });
    expect(
      evaluateRuleTiming(r, round, new Date('2026-09-18T12:00:00Z')).status
    ).toBe('not_applicable');
  });
});

describe('runDueRules', () => {
  it('runs only active, due rules and passes each rule its own settings', async () => {
    const now = new Date('2026-09-18T12:00:00Z');
    const due = rule({
      id: 'due',
      name: 'Due',
      note: 'Bring calculators',
      conditions: { roundIds: null, missingSubmissionsOnly: true, includeEntrants: true },
    });
    const paused = rule({ id: 'paused', name: 'Paused', isActive: false });
    const later = rule({ id: 'later', name: 'Later', triggerOffsetMinutes: -1 * HOUR });

    const outcome = await runDueRules([due, paused, later], round, now);

    expect(outcome.triggered).toEqual(['Due']);
    expect(planRoundClosingReminders).toHaveBeenCalledWith(
      round,
      now,
      expect.objectContaining({
        ruleId: 'due',
        note: 'Bring calculators',
        missingSubmissionsOnly: true,
      })
    );
    expect(dispatchPlanned).toHaveBeenCalledWith(expect.any(Array), 'due');
    expect(outcome.summary.sent).toBe(1);
  });
});

describe('parseConditions / describeOffset', () => {
  it('defaults to every round and including entrants', () => {
    expect(parseConditions(null)).toEqual({
      roundIds: null,
      missingSubmissionsOnly: false,
      includeEntrants: true,
    });
    // Legacy rules stored only this flag
    expect(parseConditions({ missingSubmissionsOnly: true }).missingSubmissionsOnly).toBe(true);
  });

  it('describes offsets in the largest whole unit', () => {
    expect(describeOffset(-3 * DAY, 'round_closing')).toBe('3 days before the round closes');
    expect(describeOffset(-HOUR, 'round_closing')).toBe('1 hour before the round closes');
    expect(describeOffset(0, 'results_published')).toBe('When results are published');
    expect(describeOffset(90, 'submission_overdue')).toBe('90 minutes after the round closes');
  });
});
