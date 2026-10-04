// Shape of the automation rule form, shared by the client form and the
// server actions that validate it. Timing is entered as "amount unit
// before/after" and stored as a signed minute offset.

import {
  isAutomationTrigger,
  TRIGGER_INFO,
  type AutomationTrigger,
  type RuleConditions,
} from '@/domain/notifications/automation-triggers';

export type OffsetUnit = 'minutes' | 'hours' | 'days';

export type RuleDraft = {
  name: string;
  triggerType: AutomationTrigger;
  offsetAmount: number;
  offsetUnit: OffsetUnit;
  direction: 'before' | 'after';
  // null = every round
  roundIds: string[] | null;
  missingSubmissionsOnly: boolean;
  includeEntrants: boolean;
  subject: string;
  note: string;
  isActive: boolean;
};

const UNIT_MINUTES: Record<OffsetUnit, number> = {
  minutes: 1,
  hours: 60,
  days: 24 * 60,
};

export function draftToOffsetMinutes(draft: RuleDraft): number {
  const minutes = Math.round(draft.offsetAmount * UNIT_MINUTES[draft.offsetUnit]);
  return draft.direction === 'before' ? -minutes : minutes;
}

/** Splits a stored minute offset back into the form's amount/unit/direction. */
export function offsetToDraftFields(offsetMinutes: number): Pick<
  RuleDraft,
  'offsetAmount' | 'offsetUnit' | 'direction'
> {
  const abs = Math.abs(offsetMinutes);
  const direction = offsetMinutes < 0 ? 'before' : 'after';
  if (abs !== 0 && abs % UNIT_MINUTES.days === 0) {
    return { offsetAmount: abs / UNIT_MINUTES.days, offsetUnit: 'days', direction };
  }
  if (abs !== 0 && abs % UNIT_MINUTES.hours === 0) {
    return { offsetAmount: abs / UNIT_MINUTES.hours, offsetUnit: 'hours', direction };
  }
  return { offsetAmount: abs, offsetUnit: abs === 0 ? 'days' : 'minutes', direction };
}

export function draftConditions(draft: RuleDraft): RuleConditions {
  return {
    roundIds: draft.roundIds && draft.roundIds.length > 0 ? draft.roundIds : null,
    missingSubmissionsOnly:
      draft.triggerType === 'round_closing' && draft.missingSubmissionsOnly,
    includeEntrants:
      draft.triggerType !== 'results_published' || draft.includeEntrants,
  };
}

const MAX_OFFSET_MINUTES = 365 * 24 * 60;

/**
 * Validates untrusted form input. Returns a normalised draft (direction
 * forced to what the trigger allows) or an error message.
 */
export function validateDraft(
  raw: unknown
): { draft: RuleDraft } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Invalid rule.' };
  const r = raw as Record<string, unknown>;

  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (!name) return { error: 'Give the rule a name.' };
  if (name.length > 120) return { error: 'Rule name is too long.' };

  if (!isAutomationTrigger(r.triggerType)) {
    return { error: 'Choose what triggers the rule.' };
  }
  const triggerType = r.triggerType;

  const offsetAmount = Number(r.offsetAmount);
  if (!Number.isFinite(offsetAmount) || offsetAmount < 0) {
    return { error: 'Timing must be zero or a positive number.' };
  }
  const offsetUnit: OffsetUnit =
    r.offsetUnit === 'minutes' || r.offsetUnit === 'hours' ? r.offsetUnit : 'days';

  const info = TRIGGER_INFO[triggerType];
  let direction: 'before' | 'after' = r.direction === 'before' ? 'before' : 'after';
  if (direction === 'before' && !info.allowBefore) direction = 'after';
  if (direction === 'after' && !info.allowAfter) direction = 'before';

  const roundIds = Array.isArray(r.roundIds)
    ? r.roundIds.filter((id): id is string => typeof id === 'string')
    : null;

  const subject = typeof r.subject === 'string' ? r.subject.trim() : '';
  const note = typeof r.note === 'string' ? r.note.trim() : '';
  if (subject.length > 200) return { error: 'Subject is too long.' };
  if (note.length > 2000) return { error: 'Message is too long.' };

  const draft: RuleDraft = {
    name,
    triggerType,
    offsetAmount,
    offsetUnit,
    direction,
    roundIds: roundIds && roundIds.length > 0 ? roundIds : null,
    missingSubmissionsOnly: r.missingSubmissionsOnly === true,
    includeEntrants: r.includeEntrants !== false,
    subject,
    note,
    isActive: r.isActive !== false,
  };

  if (Math.abs(draftToOffsetMinutes(draft)) > MAX_OFFSET_MINUTES) {
    return { error: 'Timing can be at most a year from the milestone.' };
  }
  return { draft };
}
