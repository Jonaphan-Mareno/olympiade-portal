import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { automationRules, rounds } from '@/lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createRule, deleteRule, toggleRuleState } from './actions';
import DryRunButton from './DryRunButton';

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

  const rules = await db
    .select()
    .from(automationRules)
    .where(eq(automationRules.portalId, olympiadId));

  const portalRounds = await db
    .select({ id: rounds.id, name: rounds.name })
    .from(rounds)
    .where(eq(rounds.portalId, olympiadId))
    .orderBy(asc(rounds.orderIndex));

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4 md:px-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Link
            href={`/organiser/olympiads/${olympiadId}`}
            className="text-blue-600 hover:underline text-sm font-medium mb-4 inline-block"
          >
            &larr; Back to Olympiad
          </Link>
          <div className="flex items-center justify-between gap-3 mb-2">
            <h1 className="text-3xl font-bold text-slate-900 m-0">
              Automation Rules
            </h1>
          </div>
          <p className="text-slate-600 text-lg mb-6">
            Configure custom triggers and email templates for your rounds.
          </p>
        </div>

        {/* Existing Rules List */}
        <div className="mb-12">
          <h2 className="text-xl font-bold text-slate-900 mb-4">Active Rules</h2>
          {rules.length === 0 ? (
            <div className="bg-white p-8 border border-dashed border-slate-300 rounded-lg text-center text-slate-500">
              No custom automation rules configured yet.
            </div>
          ) : (
            <div className="space-y-4">
              {rules.map((rule) => (
                <div key={rule.id} className="bg-white p-6 border border-slate-200 rounded-lg shadow-sm">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="font-bold text-lg text-blue-900">{rule.name}</h3>
                      <div className="text-sm text-slate-500 flex gap-4 mt-1">
                        <span><strong>Trigger:</strong> {rule.triggerType}</span>
                        <span><strong>Offset:</strong> {rule.triggerOffsetMinutes} mins</span>
                      </div>
                    </div>
                    <form action={deleteRule.bind(null, rule.id, olympiadId)}>
                      <button type="submit" className="text-red-500 hover:text-red-700 text-sm font-semibold">
                        Delete
                      </button>
                    </form>
                  </div>
                  
                  <div className="bg-slate-50 p-3 rounded border border-slate-100 text-sm font-mono text-slate-600 mb-4">
                    <div className="mb-1"><strong>Subject:</strong> {rule.templateSubject}</div>
                    <div className="truncate"><strong>HTML:</strong> {rule.templateHtml}</div>
                  </div>

                  <DryRunButton ruleId={rule.id} rounds={portalRounds} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Create Rule Form */}
        <div className="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-slate-200">
          <h2 className="text-xl font-bold text-slate-900 mb-6 border-b border-slate-100 pb-3">
            Create New Rule
          </h2>
          <form action={createRule} className="space-y-6">
            <input type="hidden" name="portalId" value={olympiadId} />
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-2">Rule Name</label>
                <input type="text" name="name" required placeholder="e.g. 24h Closing Reminder" className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500" />
              </div>
              
              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-2">Trigger Event</label>
                <select name="triggerType" required className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 bg-white">
                  <option value="round_opening">Round Opening</option>
                  <option value="round_closing">Round Closing</option>
                  <option value="submission_overdue">Submission Overdue (After Closing)</option>
                  <option value="results_published">Results Published</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-2">Offset (Minutes)</label>
                <input type="number" name="triggerOffsetMinutes" defaultValue="0" required className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500" />
                <p className="text-xs text-slate-500 mt-1">Negative for before the event, positive for after.</p>
              </div>

              <div className="flex items-center h-full pt-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" name="missingSubmissionsOnly" value="true" className="w-4 h-4 text-blue-600" />
                  <span className="text-sm font-semibold text-slate-900">Only target schools with missing submissions</span>
                </label>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-6 mt-6">
              <h3 className="text-md font-bold text-slate-800 mb-4">Email Template</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-900 mb-2">Subject</label>
                  <input type="text" name="templateSubject" required placeholder="e.g. Action Required: {{roundName}} is closing" className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-900 mb-2">HTML Body</label>
                  <textarea name="templateHtml" required placeholder="<p>Hello,</p><p>Please note that {{roundName}}...</p>" className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 h-32 font-mono text-sm" />
                  <p className="text-xs text-slate-500 mt-1">Variables available: {'{{roundName}}'}</p>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <button type="submit" className="bg-blue-700 hover:bg-blue-800 text-white font-bold py-2 px-6 rounded shadow-sm">
                Save Rule
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
