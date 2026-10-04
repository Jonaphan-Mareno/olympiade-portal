// Automation trigger definitions shared by the server (rule engine) and the
// organiser's rule form. Kept free of database imports so client components
// can use it.

export const AUTOMATION_TRIGGERS = [
  'round_opening',
  'round_closing',
  'submission_overdue',
  'results_published',
] as const;

export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

type TriggerInfo = {
  label: string;
  description: string;
  // Round milestone the offset is measured from
  milestone: string;
  // Which side of the milestone the rule may fire on
  allowBefore: boolean;
  allowAfter: boolean;
};

export const TRIGGER_INFO: Record<AutomationTrigger, TriggerInfo> = {
  round_opening: {
    label: 'Round opening reminder',
    description: 'Remind schools that a round is about to open.',
    milestone: 'the round opens',
    allowBefore: true,
    allowAfter: true,
  },
  round_closing: {
    label: 'Round closing reminder',
    description:
      'Remind schools that a round is about to close, with their submission progress.',
    milestone: 'the round closes',
    allowBefore: true,
    allowAfter: false,
  },
  submission_overdue: {
    label: 'Missing submissions follow-up',
    description:
      'Chase schools whose submissions have not arrived after the round closed.',
    milestone: 'the round closes',
    allowBefore: false,
    allowAfter: true,
  },
  results_published: {
    label: 'Results published',
    description: 'Tell schools (and optionally entrants) that results are out.',
    milestone: 'results are published',
    allowBefore: false,
    allowAfter: true,
  },
};

export function isAutomationTrigger(value: unknown): value is AutomationTrigger {
  return (
    typeof value === 'string' &&
    (AUTOMATION_TRIGGERS as readonly string[]).includes(value)
  );
}

export type RuleConditions = {
  // Rounds the rule applies to; null means every round of the olympiad
  roundIds: string[] | null;
  // round_closing: only remind schools that still have outstanding submissions
  missingSubmissionsOnly: boolean;
  // results_published: also email each entrant their own result
  includeEntrants: boolean;
};

export function parseConditions(raw: unknown): RuleConditions {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  const roundIds = Array.isArray(obj.roundIds)
    ? obj.roundIds.filter((id): id is string => typeof id === 'string')
    : null;
  return {
    roundIds: roundIds && roundIds.length > 0 ? roundIds : null,
    missingSubmissionsOnly: obj.missingSubmissionsOnly === true,
    includeEntrants: obj.includeEntrants !== false,
  };
}

export function describeOffset(
  offsetMinutes: number,
  trigger: AutomationTrigger
): string {
  const milestone = TRIGGER_INFO[trigger].milestone;
  if (offsetMinutes === 0) return `When ${milestone}`;
  const abs = Math.abs(offsetMinutes);
  const amount =
    abs % (24 * 60) === 0
      ? plural(abs / (24 * 60), 'day')
      : abs % 60 === 0
        ? plural(abs / 60, 'hour')
        : plural(abs, 'minute');
  return `${amount} ${offsetMinutes < 0 ? 'before' : 'after'} ${milestone}`;
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

