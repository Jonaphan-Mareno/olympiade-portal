import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { automationRules, portals, rounds } from '@/lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  evaluateRuleTiming,
  toRuleConfig,
} from '@/domain/notifications/automation-rules';
import type { Round } from '@/domain/rounds/round.types';
import { formatSAST } from '@/lib/sast';
import { addRecommendedRules } from './actions';
import RuleCard, { type RuleCardData } from './RuleCard';
import RuleForm from './RuleForm';

export const dynamic = 'force-dynamic';

export default async function AutomationsPage({
  params,
}: {
  params: Promise<{ olympiadId: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { olympiadId } = await params;

  const [portal] = await db
    .select({ name: portals.name, ownerUserId: portals.ownerUserId })
    .from(portals)
    .where(eq(portals.id, olympiadId));

  if (!portal || portal.ownerUserId !== user.id) {
    redirect('/organiser/dashboard');
  }

  const [ruleRows, roundRows] = await Promise.all([
    db
      .select()
      .from(automationRules)
      .where(eq(automationRules.portalId, olympiadId)),
    db
      .select()
      .from(rounds)
      .where(eq(rounds.portalId, olympiadId))
      .orderBy(asc(rounds.orderIndex)),
  ]);

  const portalRounds: Round[] = roundRows.map((r) => ({
    id: r.id,
    portalId: r.portalId,
    portalName: portal.name,
    name: r.name,
    orderIndex: r.orderIndex,
    deliveryMethod: r.deliveryMethod,
    opensAt: r.opensAt,
    closesAt: r.closesAt,
    qualifyingThreshold: r.qualifyingThreshold,
    resultsPublishedAt: r.resultsPublishedAt,
  }));
  const roundOptions = portalRounds.map((r) => ({ id: r.id, name: r.name }));

  const now = new Date();
  const rules: RuleCardData[] = ruleRows
    .map(toRuleConfig)
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .map((rule) => {
      // Earliest upcoming send across the rounds the rule applies to
      let nextSend: { roundName: string; fireAt: Date } | null = null;
      for (const round of portalRounds) {
        const timing = evaluateRuleTiming(rule, round, now);
        if (
          (timing.status === 'waiting' || timing.status === 'due') &&
          (!nextSend || timing.fireAt < nextSend.fireAt)
        ) {
          nextSend = { roundName: round.name, fireAt: timing.fireAt };
        }
      }
      return {
        id: rule.id!,
        name: rule.name,
        triggerType: rule.triggerType,
        triggerOffsetMinutes: rule.triggerOffsetMinutes,
        conditions: rule.conditions,
        subject: rule.subject,
        note: rule.note,
        isActive: rule.isActive,
        nextSend: nextSend
          ? { roundName: nextSend.roundName, at: formatSAST(nextSend.fireAt) }
          : null,
      };
    });

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4 md:px-8 text-slate-900">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Link
            href={`/organiser/olympiads/${olympiadId}`}
            className="text-blue-600 hover:underline text-sm font-medium mb-4 inline-block"
          >
            &larr; Back to Olympiad
          </Link>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">
            Automations
          </h1>
          <p className="text-slate-600 text-lg">
            Decide which reminders the portal sends to schools, when, and to
            whom. Each rule uses the portal&apos;s standard email for its
            trigger — no template writing needed. Try any rule against a round
            before it goes live.
          </p>
        </div>

        {/* Existing Rules List */}
        <div className="mb-12">
          <h2 className="text-xl font-bold text-slate-900 mb-4">Your rules</h2>
          {rules.length === 0 ? (
            <div className="bg-white p-8 border border-dashed border-slate-300 rounded-lg text-center text-slate-600">
              <p className="mb-4">
                No automations yet, so the portal won&apos;t email schools
                about this olympiad&apos;s rounds.
              </p>
              <form action={addRecommendedRules.bind(null, olympiadId)}>
                <button
                  type="submit"
                  className="bg-blue-700 hover:bg-blue-800 text-white font-semibold py-2 px-5 rounded"
                >
                  Add the recommended rules
                </button>
              </form>
              <p className="text-xs text-slate-500 mt-3">
                Opening reminder 7 days before, closing reminders 3 days and 1
                hour before, a missing-submissions follow-up 2 days after
                closing, and a results-out email. You can edit or remove any
                of them.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {rules.map((rule) => (
                <RuleCard
                  key={rule.id}
                  portalId={olympiadId}
                  rule={rule}
                  rounds={roundOptions}
                />
              ))}
            </div>
          )}
        </div>

        {/* Create Rule Form */}
        <div className="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-slate-200">
          <h2 className="text-xl font-bold text-slate-900 mb-6 border-b border-slate-100 pb-3">
            New rule
          </h2>
          <RuleForm portalId={olympiadId} rounds={roundOptions} />
        </div>
      </div>
    </div>
  );
}
