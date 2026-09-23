// Pure subject/HTML renderers for the automated reminder emails. These
// functions do no I/O, which keeps them trivially unit-testable; the
// automation engine (automation-engine.ts) is responsible for delivery via
// src/lib/email and for logging sends to notification_log.

// Formatted manually (instead of toLocaleString) so the output is
// identical on every server regardless of its ICU/CLDR data, and so email
// recipients always see unambiguous UTC times.
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${WEEKDAYS[date.getUTCDay()]}, ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

// Shared shell so every automated email looks like it came from the same
// product (mirrors the styling of the invitation email in src/lib/email).
function shell(body: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      ${body}
      <p style="color: #a1a1aa; font-size: 0.85rem; margin-top: 24px;">
        This is an automated message from the Olympiad Portal.
      </p>
    </div>
  `;
}

function button(href: string, label: string): string {
  return `
    <a href="${href}"
       style="display: inline-block; padding: 12px 24px; background: #6366f1; color: white; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 16px 0;">
      ${label}
    </a>
  `;
}

export function roundOpeningReminderEmail(params: {
  roundName: string;
  portalName: string;
  schoolName: string;
  opensAt: Date;
  closesAt: Date;
  deliveryMethod: 'online' | 'paper' | 'hybrid';
  dashboardUrl: string;
}): { subject: string; html: string } {
  return {
    subject: `Heads up: ${params.roundName} opens ${formatDate(params.opensAt)}`,
    html: shell(`
      <h2 style="color: #6366f1;">${params.roundName} is opening soon</h2>
      <p>The <strong>${params.roundName}</strong> of the <strong>${params.portalName}</strong> opens for entries soon:</p>
      <ul>
        <li><strong>Opens:</strong> ${formatDate(params.opensAt)}</li>
        <li><strong>Closes:</strong> ${formatDate(params.closesAt)}</li>
      </ul>
      <p>Delivery is <strong>${params.deliveryMethod === 'online' ? 'online (students sit the paper in the portal)' : params.deliveryMethod === 'paper' ? 'on paper (scans are submitted to the portal)' : 'hybrid (online or paper submissions)'}</strong>.
      Please make sure ${params.schoolName}'s entrants are ready to take part.</p>
      ${button(params.dashboardUrl, 'Go to your dashboard')}
    `),
  };
}

export function roundClosingReminderEmail(params: {
  roundName: string;
  portalName: string;
  schoolName: string;
  closesAt: Date;
  daysLeft: number;
  hoursLeft: number;
  submittedCount: number;
  entrantCount: number;
  dashboardUrl: string;
}): { subject: string; html: string } {
  const progress =
    params.entrantCount > 0
      ? `${params.submittedCount} of ${params.entrantCount}`
      : 'no entrants';
  // Hour-aware so a reminder sent shortly before the deadline reads
  // "closes in about 1 hour", not "closes in 0 days".
  const timeLeft =
    params.daysLeft > 0
      ? `${params.daysLeft} day${params.daysLeft === 1 ? '' : 's'}`
      : params.hoursLeft >= 1
        ? `about ${params.hoursLeft} hour${params.hoursLeft === 1 ? '' : 's'}`
        : 'less than an hour';
  return {
    subject: `Last chance: ${params.roundName} closes ${formatDate(params.closesAt)}`,
    html: shell(`
      <h2 style="color: #6366f1;">${params.roundName} closes in ${timeLeft}</h2>
      <p>The <strong>${params.roundName}</strong> of the <strong>${params.portalName}</strong> closes:</p>
      <p><strong>${formatDate(params.closesAt)}</strong></p>
      <p>Submissions so far from ${params.schoolName}: <strong>${progress}</strong> submitted.</p>
      ${button(params.dashboardUrl, 'Check submissions')}
    `),
  };
}

export function submissionOverdueFollowupEmail(params: {
  roundName: string;
  portalName: string;
  schoolName: string;
  closesAt: Date;
  missingCount: number;
  missingEntrantNames: string[];
  dashboardUrl: string;
}): { subject: string; html: string } {
  const names =
    params.missingEntrantNames.length > 0
      ? `<p>Awaiting submissions from:</p>
         <ul>${params.missingEntrantNames
           .map((n) => `<li>${escapeHtml(n)}</li>`)
           .join('')}</ul>`
      : '';
  return {
    subject: `Missing submissions: ${params.roundName} closed on ${formatDate(params.closesAt)}`,
    html: shell(`
      <h2 style="color: #dc2626;">${params.roundName} has closed, but submissions are missing</h2>
      <p>The <strong>${params.roundName}</strong> of the <strong>${params.portalName}</strong> closed on
      <strong>${formatDate(params.closesAt)}</strong>, and ${params.schoolName} has
      <strong>${params.missingCount}</strong> submission${params.missingCount === 1 ? '' : 's'} still outstanding.</p>
      ${names}
      <p>Please contact the organisers if you believe this is an error, or submit the outstanding work if it is still possible.</p>
      ${button(params.dashboardUrl, 'Review submissions')}
    `),
  };
}

export function resultsPublishedSchoolEmail(params: {
  roundName: string;
  portalName: string;
  schoolName: string;
  entrantCount: number;
  submittedCount: number;
  resultsUrl: string;
}): { subject: string; html: string } {
  return {
    subject: `Results are out: ${params.roundName}`,
    html: shell(`
      <h2 style="color: #16a34a;">${params.roundName} results are now available</h2>
      <p>Results for the <strong>${params.roundName}</strong> of the <strong>${params.portalName}</strong> have been released.</p>
      <p>At ${escapeHtml(params.schoolName)}:</p>
      <ul>
        <li><strong>${params.submittedCount}</strong> submission${params.submittedCount === 1 ? '' : 's'} received</li>
        <li><strong>${params.entrantCount}</strong> entrant${params.entrantCount === 1 ? '' : 's'} took part</li>
      </ul>
      <p>Entrants have been emailed their own results and can also view them by signing in to the portal.</p>
      ${button(params.resultsUrl, 'View school results')}
    `),
  };
}

export function resultsPublishedEntrantEmail(params: {
  roundName: string;
  portalName: string;
  entrantName: string | null;
  score: string | null;
  feedback: string | null;
  qualifyingThreshold: string | null;
  resultsUrl: string;
}): { subject: string; html: string } {
  const greeting = params.entrantName
    ? `Hi ${escapeHtml(params.entrantName)},`
    : 'Hi,';
  const scoreLine = params.score
    ? `<p>Your score: <strong>${escapeHtml(params.score)}</strong>${
        params.qualifyingThreshold
          ? ` (qualifying threshold: ${escapeHtml(params.qualifyingThreshold)})`
          : ''
      }.</p>`
    : `<p>Your submission is still being marked — keep an eye out for an update.</p>`;
  const feedbackLine = params.feedback
    ? `<p style="border-left: 3px solid #6366f1; padding-left: 12px; color: #52525b;">${escapeHtml(params.feedback)}</p>`
    : '';
  return {
    subject: `Your result for ${params.roundName} is available`,
    html: shell(`
      <h2 style="color: #16a34a;">${params.roundName} results are out</h2>
      <p>${greeting}</p>
      <p>Results for the <strong>${params.roundName}</strong> of the <strong>${escapeHtml(params.portalName)}</strong> have been released.</p>
      ${scoreLine}
      ${feedbackLine}
      <p>Sign in to the portal to view your full breakdown.</p>
      ${button(params.resultsUrl, 'View my result')}
    `),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
