'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  checkOnlinePublishReadiness,
  checkPhysicalPublishReadiness,
  type ReadinessIssue,
  type ReadinessResult,
} from '@/domain/question-bank/publish-readiness';
import type { PoolQuestion } from '@/domain/question-bank/variant-generator';
import { QUESTIONS_CHANGED_EVENT } from '@/components/organiser/QuestionBuilder';
import { TARGET_CHANGED_EVENT } from '@/components/organiser/PaperMarkingFields';
import { SELECTION_CHANGED_EVENT } from '@/components/organiser/PhysicalPaperSelector';

/**
 * Advisory publish-readiness panel. It runs the SAME pure checkers the server
 * actions run (checkOnlinePublishReadiness / checkPhysicalPublishReadiness) so
 * the organiser sees, live, exactly why a round cannot be published yet:
 * a summary banner plus per-question inline errors keyed by questionId.
 *
 * It is advisory only — the server action stays authoritative and re-runs the
 * guard before writing. It exposes readiness three ways so it works with either
 * parent style: an `onReadinessChange` callback (client parents gate the button
 * via React state), a `submitButtonId` it disables directly (server-component
 * parents), and a window event other islands can listen to.
 */
export const READINESS_CHANGED_EVENT = 'olympiad:readiness-changed';

type DeliveryMethod = 'paper' | 'online' | 'hybrid';

type PoolSeed = {
  id: string;
  prompt?: string | null;
  marks?: number | string | null;
  difficulty?: number | string | null;
};

function num(raw: number | string | null | undefined): number | null {
  if (raw === '' || raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

type PanelItem = PoolQuestion & { prompt: string };

function toItem(q: PoolSeed): PanelItem {
  return {
    id: String(q.id),
    prompt: q.prompt ?? '',
    marks: num(q.marks),
    difficulty: num(q.difficulty),
  };
}

function mergeResults(results: ReadinessResult[]): ReadinessResult {
  return {
    ok: results.every((r) => r.ok),
    issues: results.flatMap((r) => r.issues),
    summary: results.flatMap((r) => r.summary),
  };
}

const OK: ReadinessResult = { ok: true, issues: [], summary: [] };

export default function PublishReadinessPanel({
  pool = [],
  targetTotal = null,
  selectedIds = null,
  deliveryMethod,
  onReadinessChange,
  submitButtonId,
}: {
  pool?: PoolSeed[];
  targetTotal?: number | null;
  selectedIds?: string[] | null;
  deliveryMethod: DeliveryMethod;
  onReadinessChange?: (ok: boolean) => void;
  submitButtonId?: string;
}) {
  const [items, setItems] = useState<PanelItem[]>(() => pool.map(toItem));
  const [target, setTarget] = useState<number | null>(targetTotal ?? null);
  const [selected, setSelected] = useState<string[]>(() =>
    Array.isArray(selectedIds) ? selectedIds.map(String) : []
  );

  useEffect(() => {
    const onQuestions = (e: Event) => {
      const detail = (e as CustomEvent).detail as { questions?: PoolSeed[] };
      setItems((detail?.questions ?? []).map(toItem));
    };
    const onTarget = (e: Event) => {
      const detail = (e as CustomEvent).detail as { targetTotalMarks?: number | null };
      setTarget(detail?.targetTotalMarks ?? null);
    };
    const onSelection = (e: Event) => {
      const detail = (e as CustomEvent).detail as { selectedQuestionIds?: string[] };
      setSelected((detail?.selectedQuestionIds ?? []).map(String));
    };
    window.addEventListener(QUESTIONS_CHANGED_EVENT, onQuestions as EventListener);
    window.addEventListener(TARGET_CHANGED_EVENT, onTarget as EventListener);
    window.addEventListener(SELECTION_CHANGED_EVENT, onSelection as EventListener);
    return () => {
      window.removeEventListener(QUESTIONS_CHANGED_EVENT, onQuestions as EventListener);
      window.removeEventListener(TARGET_CHANGED_EVENT, onTarget as EventListener);
      window.removeEventListener(SELECTION_CHANGED_EVENT, onSelection as EventListener);
    };
  }, []);

  // Blank builder placeholders (no prompt) are never persisted, so drop them
  // before checking — this keeps the advisory panel identical to the guard the
  // server action runs.
  const filteredPool = useMemo(
    () => items.filter((i) => i.prompt.trim() !== ''),
    [items]
  );

  const result = useMemo<ReadinessResult>(() => {
    const isOnlineish = deliveryMethod === 'online' || deliveryMethod === 'hybrid';
    const isPhysicalish = deliveryMethod === 'paper' || deliveryMethod === 'hybrid';
    const hasSubstantive = filteredPool.length > 0;

    const results: ReadinessResult[] = [];
    if (isOnlineish) {
      results.push(checkOnlinePublishReadiness(filteredPool, target ?? 0));
    }
    // A pure paper round that only uploads a PDF (blank pool, no selection)
    // has nothing to guard; require a selection only once a pool/selection
    // exists. Hybrid always guards both dimensions.
    const physicalApplies =
      deliveryMethod === 'hybrid' || selected.length > 0 || hasSubstantive;
    if (isPhysicalish && physicalApplies) {
      results.push(checkPhysicalPublishReadiness(filteredPool, selected));
    }
    return results.length > 0 ? mergeResults(results) : OK;
  }, [filteredPool, target, selected, deliveryMethod]);

  // Expose readiness to the parent / other islands, and gate the submit button
  // when a server-component parent handed us its id.
  useEffect(() => {
    onReadinessChange?.(result.ok);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(READINESS_CHANGED_EVENT, { detail: { ok: result.ok } })
      );
      if (submitButtonId) {
        const btn = document.getElementById(submitButtonId) as HTMLButtonElement | null;
        if (btn) btn.disabled = !result.ok;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.ok, submitButtonId]);

  // Label each question-scoped issue with its position in the pool.
  const orderOf = useMemo(() => {
    const m = new Map<string, number>();
    filteredPool.forEach((q, i) => m.set(q.id, i + 1));
    return m;
  }, [filteredPool]);

  const generalIssues = result.issues.filter((i) => !i.questionId);
  const questionIssues = result.issues.filter((i) => i.questionId);

  const label = (issue: ReadinessIssue) => {
    const n = issue.questionId ? orderOf.get(issue.questionId) : undefined;
    return n ? `Question ${n}` : 'Selection';
  };

  return (
    <div
      data-testid="publish-readiness-panel"
      data-ok={result.ok ? 'true' : 'false'}
      className={`rounded-lg border p-5 ${
        result.ok
          ? 'border-green-300 bg-green-50'
          : 'border-amber-300 bg-amber-50'
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`inline-block w-2.5 h-2.5 rounded-full ${
            result.ok ? 'bg-green-500' : 'bg-amber-500'
          }`}
          aria-hidden
        />
        <h3
          className={`text-sm font-bold uppercase tracking-wide ${
            result.ok ? 'text-green-800' : 'text-amber-900'
          }`}
        >
          {result.ok ? 'Ready to publish' : 'Not ready to publish'}
        </h3>
      </div>

      {result.summary.length > 0 && (
        <ul className="text-sm text-slate-700 space-y-1 mb-2" data-testid="readiness-summary">
          {result.summary.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}

      {!result.ok && (
        <>
          {generalIssues.length > 0 && (
            <ul className="text-sm text-amber-900 space-y-1 mb-2" data-testid="readiness-general">
              {generalIssues.map((issue, i) => (
                <li key={i}>• {issue.message}</li>
              ))}
            </ul>
          )}
          {questionIssues.length > 0 && (
            <ul className="text-sm space-y-1" data-testid="readiness-question-issues">
              {questionIssues.map((issue, i) => (
                <li key={i} className="text-amber-900">
                  <span className="font-semibold">{label(issue)}:</span> {issue.message}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-amber-800 mt-3">
            You can keep editing below, but saving / publishing this round is
            blocked until every issue above is resolved.
          </p>
        </>
      )}
    </div>
  );
}
