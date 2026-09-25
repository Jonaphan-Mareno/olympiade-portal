'use server';

import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { automationRules, rounds } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import {
  getEducatorsForPortal,
  getEntrantSubmissionStatus,
} from '@/domain/notifications/automation-engine';
import {
  roundOpeningReminderEmail,
  roundClosingReminderEmail,
  submissionOverdueFollowupEmail,
  resultsPublishedSchoolEmail,
  resultsPublishedEntrantEmail,
} from '@/domain/notifications/email-templates';
import type { Round } from '@/domain/rounds/round.types';

export type DryRunResult = {
  ruleName: string;
  matchedRecipients: number;
  sampleEmail?: {
    to: string;
    subject: string;
    html: string;
  };
  error?: string;
};

export async function runDryRun(ruleId: string, roundId: string): Promise<DryRunResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const [rule] = await db.select().from(automationRules).where(eq(automationRules.id, ruleId));
  if (!rule) return { error: 'Rule not found', ruleName: '', matchedRecipients: 0 };

  const [row] = await db.select().from(rounds).where(eq(rounds.id, roundId));
  if (!row) return { error: 'Round not found', ruleName: rule.name, matchedRecipients: 0 };

  const portalName = "Your Olympiad Portal"; // simplified for dry run
  const dashboardUrl = "https://example.com/dashboard";
  const resultsUrl = "https://example.com/results";

  const educators = await getEducatorsForPortal(row.portalId);
  const { entrants, submittedMembershipIds } = await getEntrantSubmissionStatus(row.portalId, row.id);

  let matchedRecipients = 0;
  let sampleEmail = undefined;

  const getDaysHours = (date: Date) => {
    const msLeft = Math.max(date.getTime() - Date.now(), 0);
    return {
      daysLeft: Math.floor(msLeft / (24 * 60 * 60 * 1000)),
      hoursLeft: Math.floor(msLeft / (60 * 60 * 1000)) % 24,
    };
  };

  try {
    if (rule.triggerType === 'round_opening' || rule.triggerType === 'round_closing') {
      matchedRecipients = educators.length;
      if (educators.length > 0) {
        const ed = educators[0];
        const emailContent = rule.triggerType === 'round_opening' 
          ? roundOpeningReminderEmail({
              roundName: row.name, portalName, schoolName: ed.schoolName, 
              opensAt: row.opensAt, closesAt: row.closesAt, deliveryMethod: row.deliveryMethod as any, dashboardUrl
            })
          : roundClosingReminderEmail({
              roundName: row.name, portalName, schoolName: ed.schoolName,
              closesAt: row.closesAt, daysLeft: getDaysHours(row.closesAt).daysLeft, hoursLeft: getDaysHours(row.closesAt).hoursLeft,
              submittedCount: 0, entrantCount: 1, dashboardUrl
            });
        
        // Use custom templates if provided (we can compile them later, but for now we just show the dynamic ones)
        sampleEmail = {
          to: ed.email,
          subject: rule.templateSubject.replace('{{roundName}}', row.name),
          html: emailContent.html, // In a real system, we'd compile rule.templateHtml
        };
      }
    } else if (rule.triggerType === 'submission_overdue') {
      const missingBySchool = new Map<string, { count: number; names: string[] }>();
      for (const entrant of entrants) {
        if (!entrant.schoolId || submittedMembershipIds.has(entrant.membershipId)) continue;
        const missing = missingBySchool.get(entrant.schoolId) ?? { count: 0, names: [] };
        missing.count++;
        missing.names.push(entrant.name ?? entrant.email);
        missingBySchool.set(entrant.schoolId, missing);
      }
      
      const missingEducators = educators.filter(ed => missingBySchool.has(ed.schoolId));
      matchedRecipients = missingEducators.length;

      if (missingEducators.length > 0) {
        const ed = missingEducators[0];
        const missing = missingBySchool.get(ed.schoolId)!;
        const emailContent = submissionOverdueFollowupEmail({
          roundName: row.name, portalName, schoolName: ed.schoolName,
          closesAt: row.closesAt, missingCount: missing.count, missingEntrantNames: missing.names, dashboardUrl
        });
        sampleEmail = {
          to: ed.email,
          subject: rule.templateSubject.replace('{{roundName}}', row.name),
          html: emailContent.html,
        };
      }
    } else if (rule.triggerType === 'results_published') {
      matchedRecipients = educators.length + entrants.length;
      if (educators.length > 0) {
        const ed = educators[0];
        const emailContent = resultsPublishedSchoolEmail({
          roundName: row.name, portalName, schoolName: ed.schoolName,
          entrantCount: 1, submittedCount: 1, resultsUrl
        });
        sampleEmail = {
          to: ed.email,
          subject: rule.templateSubject.replace('{{roundName}}', row.name),
          html: emailContent.html,
        };
      }
    }
  } catch (err: any) {
    return { error: err.message, ruleName: rule.name, matchedRecipients: 0 };
  }

  return { ruleName: rule.name, matchedRecipients, sampleEmail };
}
