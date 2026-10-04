'use client';

import { useState, useTransition } from 'react';
import {
  AUTOMATION_TRIGGERS,
  TRIGGER_INFO,
  describeOffset,
  type AutomationTrigger,
} from '@/domain/notifications/automation-triggers';
import { saveRule } from './actions';
import { simulateDraftRule } from './dry-run';
import { draftToOffsetMinutes, type RuleDraft } from './rule-input';
import SimulationPanel from './SimulationPanel';

type RoundOption = { id: string; name: string };

const DEFAULT_DRAFT: RuleDraft = {
  name: '',
  triggerType: 'round_closing',
  offsetAmount: 1,
  offsetUnit: 'days',
  direction: 'before',
  roundIds: null,
  missingSubmissionsOnly: false,
  includeEntrants: true,
  subject: '',
  note: '',
  isActive: true,
};

const inputClass =
  'w-full p-2 border border-slate-300 rounded bg-white text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 focus:outline-none';
const labelClass = 'block text-sm font-semibold text-slate-900 mb-2';

export default function RuleForm({
  portalId,
  rounds,
  ruleId,
  initial,
  onDone,
}: {
  portalId: string;
  rounds: RoundOption[];
  ruleId?: string;
  initial?: RuleDraft;
  onDone?: () => void;
}) {
  const [draft, setDraft] = useState<RuleDraft>(initial ?? DEFAULT_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [showTry, setShowTry] = useState(false);
  const [isSaving, startSaving] = useTransition();

  const info = TRIGGER_INFO[draft.triggerType];
  const update = (patch: Partial<RuleDraft>) =>
    setDraft((d) => ({ ...d, ...patch }));

  const changeTrigger = (triggerType: AutomationTrigger) => {
    const next = TRIGGER_INFO[triggerType];
    update({
      triggerType,
      direction:
        draft.direction === 'before' && !next.allowBefore
          ? 'after'
          : draft.direction === 'after' && !next.allowAfter
            ? 'before'
            : draft.direction,
    });
  };

  const toggleRound = (id: string) => {
    const current = draft.roundIds ?? [];
    update({
      roundIds: current.includes(id)
        ? current.filter((r) => r !== id)
        : [...current, id],
    });
  };

  const handleSave = () => {
    setError(null);
    startSaving(async () => {
      const res = await saveRule(portalId, draft, ruleId);
      if (res.error) {
        setError(res.error);
        return;
      }
      if (!ruleId) {
        setDraft(DEFAULT_DRAFT);
        setShowTry(false);
      }
      onDone?.();
    });
  };

  return (
    <div className="space-y-6 text-slate-900">
      <div>
        <label className={labelClass}>Rule name</label>
        <input
          type="text"
          value={draft.name}
          onChange={(e) => update({ name: e.target.value })}
          placeholder="e.g. 24h closing reminder"
          className={inputClass}
        />
      </div>

      {/* WHEN: trigger */}
      <fieldset>
        <legend className={labelClass}>When — what triggers it</legend>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {AUTOMATION_TRIGGERS.map((t) => (
            <label
              key={t}
              className={`flex gap-3 p-3 border rounded cursor-pointer ${
                draft.triggerType === t
                  ? 'border-blue-600 bg-blue-50'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <input
                type="radio"
                name={`trigger-${ruleId ?? 'new'}`}
                checked={draft.triggerType === t}
                onChange={() => changeTrigger(t)}
                className="mt-1"
              />
              <span>
                <span className="block font-semibold text-slate-900">
                  {TRIGGER_INFO[t].label}
                </span>
                <span className="block text-xs text-slate-600">
                  {TRIGGER_INFO[t].description}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* WHEN: timing */}
      <div>
        <label className={labelClass}>Send it</label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            min={0}
            value={draft.offsetAmount}
            onChange={(e) => update({ offsetAmount: Number(e.target.value) })}
            className={`${inputClass} w-24`}
          />
          <select
            value={draft.offsetUnit}
            onChange={(e) =>
              update({ offsetUnit: e.target.value as RuleDraft['offsetUnit'] })
            }
            className={`${inputClass} w-auto`}
          >
            <option value="minutes">minutes</option>
            <option value="hours">hours</option>
            <option value="days">days</option>
          </select>
          <select
            value={draft.direction}
            onChange={(e) =>
              update({ direction: e.target.value as RuleDraft['direction'] })
            }
            className={`${inputClass} w-auto`}
          >
            {info.allowBefore && <option value="before">before</option>}
            {info.allowAfter && <option value="after">after</option>}
          </select>
          <span className="text-sm text-slate-700">{info.milestone}</span>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          {describeOffset(draftToOffsetMinutes(draft), draft.triggerType)}. The
          portal checks hourly, so emails go out within the hour.
        </p>
      </div>

      {/* CONDITIONS */}
      <fieldset className="space-y-3">
        <legend className={labelClass}>Conditions</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={`scope-${ruleId ?? 'new'}`}
              checked={draft.roundIds === null}
              onChange={() => update({ roundIds: null })}
            />
            Every round
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={`scope-${ruleId ?? 'new'}`}
              checked={draft.roundIds !== null}
              onChange={() => update({ roundIds: [] })}
            />
            Only specific rounds
          </label>
        </div>
        {draft.roundIds !== null && (
          <div className="flex flex-wrap gap-3 pl-1">
            {rounds.length === 0 && (
              <span className="text-sm text-slate-500">No rounds yet.</span>
            )}
            {rounds.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.roundIds?.includes(r.id) ?? false}
                  onChange={() => toggleRound(r.id)}
                />
                {r.name}
              </label>
            ))}
          </div>
        )}

        {draft.triggerType === 'round_closing' && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.missingSubmissionsOnly}
              onChange={(e) => update({ missingSubmissionsOnly: e.target.checked })}
            />
            Only remind schools that still have entrants who haven&apos;t submitted
          </label>
        )}
        {draft.triggerType === 'submission_overdue' && (
          <p className="text-xs text-slate-500">
            Only schools with outstanding submissions are contacted, and only
            until results are published.
          </p>
        )}
      </fieldset>

      {/* WHAT FOLLOWS */}
      <fieldset className="space-y-3">
        <legend className={labelClass}>What follows</legend>
        <p className="text-sm text-slate-700">
          Each school&apos;s educators get the portal&apos;s{' '}
          {info.label.toLowerCase()} email, filled in with the round, dates and
          that school&apos;s own submission figures.
        </p>
        {draft.triggerType === 'results_published' && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.includeEntrants}
              onChange={(e) => update({ includeEntrants: e.target.checked })}
            />
            Also email each entrant their own result
          </label>
        )}
        <div>
          <label className="block text-sm font-medium text-slate-800 mb-1">
            Subject (optional)
          </label>
          <input
            type="text"
            value={draft.subject}
            onChange={(e) => update({ subject: e.target.value })}
            placeholder="Leave blank for the default subject"
            className={inputClass}
          />
          <p className="text-xs text-slate-500 mt-1">
            You can use {'{{roundName}}'}, {'{{schoolName}}'} and{' '}
            {'{{portalName}}'}.
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-800 mb-1">
            Extra message (optional)
          </label>
          <textarea
            value={draft.note}
            onChange={(e) => update({ note: e.target.value })}
            placeholder="Added under the standard email, e.g. “Remember to upload scans as a single PDF.”"
            className={`${inputClass} h-24 text-sm`}
          />
        </div>
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.isActive}
          onChange={(e) => update({ isActive: e.target.checked })}
        />
        Active — untick to save it paused while you try it out
      </label>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-800 text-sm rounded">
          {error}
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-3 pt-2">
        {onDone && ruleId && (
          <button
            type="button"
            onClick={onDone}
            className="px-4 py-2 text-sm font-semibold text-slate-700 hover:text-slate-900"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowTry((v) => !v)}
          className="px-4 py-2 text-sm font-semibold text-blue-700 border border-blue-300 rounded hover:bg-blue-50"
        >
          Try against a round
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white font-bold py-2 px-6 rounded shadow-sm"
        >
          {isSaving ? 'Saving…' : ruleId ? 'Save changes' : 'Save rule'}
        </button>
      </div>

      {showTry && (
        <SimulationPanel
          rounds={rounds}
          run={(roundId) => simulateDraftRule(portalId, draft, roundId)}
        />
      )}
    </div>
  );
}
