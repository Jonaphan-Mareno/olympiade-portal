import { describe, it, expect } from 'vitest';
import {
  roundOpeningReminderEmail,
  roundClosingReminderEmail,
  submissionOverdueFollowupEmail,
  resultsPublishedSchoolEmail,
  resultsPublishedEntrantEmail,
} from '@/domain/notifications/email-templates';

describe('roundOpeningReminderEmail', () => {
  it('includes the round, portal and opening/closing times', () => {
    const opensAt = new Date('2026-09-21T09:00:00Z');
    const closesAt = new Date('2026-09-28T17:00:00Z');
    const { subject, html } = roundOpeningReminderEmail({
      roundName: 'Round 1',
      portalName: 'Maths Olympiad',
      schoolName: 'Springfield High',
      opensAt,
      closesAt,
      deliveryMethod: 'paper',
      dashboardUrl: 'http://localhost:3000/educator/dashboard?portalId=p1',
    });

    expect(subject).toContain('Round 1');
    expect(html).toContain('Maths Olympiad');
    expect(html).toContain('Springfield High');
    expect(html).toContain('paper');
    expect(html).toContain(
      'http://localhost:3000/educator/dashboard?portalId=p1'
    );
    // Times are rendered in UTC so they are unambiguous
    expect(html).toContain('21 Sep 2026');
    expect(html).toContain('28 Sep 2026');
  });
});

describe('roundClosingReminderEmail', () => {
  it('shows days left and per-school submission progress', () => {
    const { subject, html } = roundClosingReminderEmail({
      roundName: 'Round 1',
      portalName: 'Maths Olympiad',
      schoolName: 'Springfield High',
      closesAt: new Date('2026-09-16T17:00:00Z'),
      daysLeft: 2,
      hoursLeft: 0,
      submittedCount: 3,
      entrantCount: 5,
      dashboardUrl: 'http://localhost:3000/educator/dashboard?portalId=p1',
    });

    expect(subject).toContain('closes');
    expect(html).toContain('closes in 2 days');
    expect(html).toContain('3 of 5');
  });

  it('handles schools with no entrants gracefully', () => {
    const { html } = roundClosingReminderEmail({
      roundName: 'Round 1',
      portalName: 'Maths Olympiad',
      schoolName: 'Empty High',
      closesAt: new Date('2026-09-16T17:00:00Z'),
      daysLeft: 1,
      hoursLeft: 0,
      submittedCount: 0,
      entrantCount: 0,
      dashboardUrl: 'http://localhost:3000/educator/dashboard?portalId=p1',
    });

    expect(html).toContain('no entrants');
    expect(html).toContain('closes in 1 day');
  });

  it('switches to hours when less than a day remains', () => {
    const { html } = roundClosingReminderEmail({
      roundName: 'Round 1',
      portalName: 'Maths Olympiad',
      schoolName: 'Springfield High',
      closesAt: new Date('2026-09-14T08:00:00Z'),
      daysLeft: 0,
      hoursLeft: 1,
      submittedCount: 3,
      entrantCount: 5,
      dashboardUrl: 'http://localhost:3000/educator/dashboard?portalId=p1',
    });

    expect(html).toContain('closes in about 1 hour');
    expect(html).not.toContain('closes in 0 days');
  });

  it('pluralises hours above one', () => {
    const { html } = roundClosingReminderEmail({
      roundName: 'Round 1',
      portalName: 'Maths Olympiad',
      schoolName: 'Springfield High',
      closesAt: new Date('2026-09-14T11:00:00Z'),
      daysLeft: 0,
      hoursLeft: 4,
      submittedCount: 3,
      entrantCount: 5,
      dashboardUrl: 'http://localhost:3000/educator/dashboard?portalId=p1',
    });

    expect(html).toContain('closes in about 4 hours');
  });

  it('handles the final stretch before the deadline', () => {
    const { html } = roundClosingReminderEmail({
      roundName: 'Round 1',
      portalName: 'Maths Olympiad',
      schoolName: 'Springfield High',
      closesAt: new Date('2026-09-14T07:30:00Z'),
      daysLeft: 0,
      hoursLeft: 0,
      submittedCount: 3,
      entrantCount: 5,
      dashboardUrl: 'http://localhost:3000/educator/dashboard?portalId=p1',
    });

    expect(html).toContain('closes in less than an hour');
  });
});

describe('submissionOverdueFollowupEmail', () => {
  it('names the entrants whose submissions are missing', () => {
    const { subject, html } = submissionOverdueFollowupEmail({
      roundName: 'Round 1',
      portalName: 'Maths Olympiad',
      schoolName: 'Springfield High',
      closesAt: new Date('2026-09-10T17:00:00Z'),
      missingCount: 2,
      missingEntrantNames: ['Lisa Simpson', 'Milhouse Van Houten'],
      dashboardUrl: 'http://localhost:3000/educator/dashboard?portalId=p1',
    });

    expect(subject).toContain('Missing submissions');
    expect(html).toContain('<strong>2</strong> submissions');
    expect(html).toContain('Lisa Simpson');
    expect(html).toContain('Milhouse Van Houten');
    // Closing date is rendered in unambiguous UTC
    expect(html).toContain('10 Sep 2026');
  });

  it('escapes HTML in entrant names', () => {
    const { html } = submissionOverdueFollowupEmail({
      roundName: 'Round 1',
      portalName: 'Maths Olympiad',
      schoolName: 'Springfield High',
      closesAt: new Date('2026-09-10T17:00:00Z'),
      missingCount: 1,
      missingEntrantNames: ['<script>alert(1)</script>'],
      dashboardUrl: 'http://localhost:3000/educator/dashboard?portalId=p1',
    });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('resultsPublishedSchoolEmail', () => {
  it('summarises submissions and entrants for the school', () => {
    const { subject, html } = resultsPublishedSchoolEmail({
      roundName: 'Round 1',
      portalName: 'Maths Olympiad',
      schoolName: 'Springfield High',
      entrantCount: 5,
      submittedCount: 4,
      resultsUrl: 'http://localhost:3000/results/p1',
    });

    expect(subject).toBe('Results are out: Round 1');
    expect(html).toContain('<strong>4</strong> submission');
    expect(html).toContain('<strong>5</strong> entrants');
    expect(html).toContain('http://localhost:3000/results/p1');
    // Entrants are told their own result separately
    expect(html).toContain('been emailed');
  });
});

describe('resultsPublishedEntrantEmail', () => {
  it('shows the score and feedback when marked', () => {
    const { subject, html } = resultsPublishedEntrantEmail({
      roundName: 'Round 1',
      portalName: 'Maths Olympiad',
      entrantName: 'Lisa Simpson',
      score: '42',
      feedback: 'Excellent work',
      qualifyingThreshold: '30',
      resultsUrl: 'http://localhost:3000/results/p1',
    });

    expect(subject).toContain('Your result for Round 1');
    expect(html).toContain('Hi Lisa Simpson,');
    expect(html).toContain('<strong>42</strong>');
    expect(html).toContain('30');
    expect(html).toContain('Excellent work');
  });

  it('degrades gracefully when the score is not ready yet', () => {
    const { html } = resultsPublishedEntrantEmail({
      roundName: 'Round 1',
      portalName: 'Maths Olympiad',
      entrantName: null,
      score: null,
      feedback: null,
      qualifyingThreshold: null,
      resultsUrl: 'http://localhost:3000/results/p1',
    });

    expect(html).toContain('Hi,');
    expect(html).toContain('still being marked');
    expect(html).not.toContain('null');
  });

  it('escapes HTML in feedback', () => {
    const { html } = resultsPublishedEntrantEmail({
      roundName: 'Round 1',
      portalName: 'Maths <Olympiad>',
      entrantName: 'Lisa',
      score: '1',
      feedback: '<b>bold</b>',
      qualifyingThreshold: null,
      resultsUrl: 'http://localhost:3000/results/p1',
    });

    expect(html).not.toContain('<Olympiad>');
    expect(html).toContain('&lt;Olympiad&gt;');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;');
  });
});
