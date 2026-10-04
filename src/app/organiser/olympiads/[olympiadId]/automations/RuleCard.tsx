'use client';

import { useState, useTransition } from 'react';
import {
  TRIGGER_INFO,
  describeOffset,
  type AutomationTrigger,
  type RuleConditions,
} from '@/domain/notifications/automation-triggers';
import { deleteRule, toggleRuleState } from './actions';
import { simulateSavedRule } from './dry-run';
import { offsetToDraftFields, type RuleDraft } from './rule-input';
import RuleForm from './RuleForm';
import SimulationPanel from './SimulationPanel';

type RoundOption = { id: string; name: string };

export type RuleCardData = {
  id: string;
  name: string;
  triggerType: AutomationTrigger;
  triggerOffsetMinutes: number;
  conditions: RuleConditions;
  subject: string;
  note: string;
  isActive: boolean;
  // Precomputed on the server: the next upcoming send (formatted), if any
  nextSend: { roundName: string; at: string } | null;
};

export default function RuleCard({
  portalId,
  rule,
  rounds,
}: {
  portalId: string;
  rule: RuleCardData;
  rounds: RoundOption[];
}) {
  const [mode, setMode] = useState<'view' | 'edit' | 'try'>('view');
  const [isPending, startTransition] = useTransition();

  const roundNames = rule.conditions.roundIds
    ? rounds
        .filter((r) => rule.conditions.roundIds!.includes(r.id))
        .map((r) => r.name)
    : null;

  const initialDraft: RuleDraft = {
    name: rule.name,
    triggerType: rule.triggerType,
    ...offsetToDraftFields(rule.triggerOffsetMinutes),
    roundIds: rule.conditions.roundIds,
    missingSubmissionsOnly: rule.conditions.missingSubmissionsOnly,
    includeEntrants: rule.conditions.includeEntrants,
    subject: rule.subject,
    note: rule.note,
    isActive: rule.isActive,
  };

  return (
    <div
      className={`bg-white p-6 border rounded-lg shadow-sm text-slate-900 ${
        rule.isActive ? 'border-slate-200' : 'border-dashed border-slate-300'
      }`}
    >
      <div className="flex flex-col sm:flex-row justify-between items-start gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-lg text-blue-900">{rule.name}</h3>
            <span
              className={`px-2 py-0.5 text-xs font-bold rounded ${
                rule.isActive
                  ? 'bg-green-100 text-green-800'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              {rule.isActive ? 'Active' : 'Paused'}
            </span>
          </div>
          <div className="text-sm text-slate-700 mt-1">
            <strong>{TRIGGER_INFO[rule.triggerType].label}</strong> ·{' '}
            {describeOffset(rule.triggerOffsetMinutes, rule.triggerType)}
          </div>
        </div>
        <div className="flex gap-4 text-sm font-semibold">
          <button
            type="button"
            disabled={isPending}
            onClick={() =>
              startTransition(() =>
                toggleRuleState(rule.id, portalId, !rule.isActive)
              )
            }
            className="text-slate-700 hover:text-slate-900"
          >
            {rule.isActive ? 'Pause' : 'Activate'}
          </button>
          <button
            type="button"
            onClick={() => setMode(mode === 'edit' ? 'view' : 'edit')}
            className="text-blue-700 hover:text-blue-900"
          >
            Edit
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              if (confirm(`Delete the rule "${rule.name}"?`)) {
                startTransition(() => deleteRule(rule.id, portalId));
              }
            }}
            className="text-red-600 hover:text-red-800"
          >
            Delete
          </button>
        </div>
      </div>

      {mode === 'edit' ? (
        <div className="border-t border-slate-100 pt-4">
          <RuleForm
            portalId={portalId}
            rounds={rounds}
            ruleId={rule.id}
            initial={initialDraft}
            onDone={() => setMode('view')}
          />
        </div>
      ) : (
        <>
          <ul className="text-sm text-slate-700 space-y-1 mb-4">
            <li>
              <strong>Rounds:</strong>{' '}
              {roundNames
                ? roundNames.length > 0
                  ? roundNames.join(', ')
                  : 'none selected'
                : 'every round'}
            </li>
            {rule.triggerType === 'round_closing' &&
              rule.conditions.missingSubmissionsOnly && (
                <li>Only schools with outstanding submissions</li>
              )}
            {rule.triggerType === 'results_published' && (
              <li>
                Emails school educators
                {rule.conditions.includeEntrants
                  ? ' and each entrant their own result'
                  : ' only'}
              </li>
            )}
            {rule.subject && (
              <li>
                <strong>Subject:</strong> {rule.subject}
              </li>
            )}
            {rule.note && (
              <li className="truncate">
                <strong>Extra message:</strong> {rule.note}
              </li>
            )}
            <li>
              <strong>Next send:</strong>{' '}
              {rule.nextSend
                ? `${rule.nextSend.roundName} — ${rule.nextSend.at}`
                : 'nothing scheduled'}
            </li>
          </ul>

          <button
            type="button"
            onClick={() => setMode(mode === 'try' ? 'view' : 'try')}
            className="text-blue-700 hover:text-blue-900 text-sm font-semibold"
          >
            {mode === 'try' ? 'Hide dry run' : 'Try against a round'}
          </button>
          {mode === 'try' && (
            <div className="mt-3">
              <SimulationPanel
                rounds={rounds}
                run={(roundId) => simulateSavedRule(portalId, rule.id, roundId)}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
