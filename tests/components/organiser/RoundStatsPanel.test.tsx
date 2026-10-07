import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import RoundStatsPanel from '@/components/organiser/RoundStatsPanel';
import type { RoundStats } from '@/domain/rounds/round-stats';

const stats: RoundStats = {
  entrants: 24,
  wrote: 20,
  completed: 18,
  marked: 16,
  averageScore: 57.9,
  averagePercentage: 72.4,
  passRate: 62.5,
  advanced: 10,
};

describe('RoundStatsPanel', () => {
  it('renders every statistic card', () => {
    render(<RoundStatsPanel stats={stats} totalMarks={80} />);

    expect(screen.getByText('Round Statistics')).toBeInTheDocument();
    for (const label of [
      'Registered Entrants',
      'Wrote',
      'Completed',
      'Marked',
      'Average Mark',
      'Pass Rate',
      'Advanced In',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();
    expect(screen.getByText('of 20 who wrote (90%)')).toBeInTheDocument();
    expect(screen.getByText('72.4%')).toBeInTheDocument();
    expect(screen.getByText('avg 57.9 of 80 marks')).toBeInTheDocument();
    expect(screen.getByText('62.5%')).toBeInTheDocument();
    expect(screen.getByText('vs qualifying threshold')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('qualified from previous round')).toBeInTheDocument();
  });

  it('falls back to raw marks when no total is known', () => {
    render(
      <RoundStatsPanel stats={{ ...stats, averagePercentage: null }} totalMarks={0} />
    );

    expect(screen.getByText('57.9')).toBeInTheDocument();
    expect(screen.getByText('avg raw marks')).toBeInTheDocument();
  });

  it('shows Not set when the round has no qualifying threshold', () => {
    render(<RoundStatsPanel stats={{ ...stats, passRate: null }} totalMarks={80} />);

    expect(screen.getByText('Not set')).toBeInTheDocument();
  });

  it('shows a dash when nothing has been marked yet', () => {
    render(
      <RoundStatsPanel
        stats={{ ...stats, averageScore: null, averagePercentage: null }}
        totalMarks={80}
      />
    );

    expect(screen.getByText('–')).toBeInTheDocument();
    expect(screen.getByText('no marks captured yet')).toBeInTheDocument();
  });

  it('describes completion against writers once someone wrote', () => {
    render(
      <RoundStatsPanel stats={{ ...stats, wrote: 0, completed: 0 }} totalMarks={80} />
    );

    expect(screen.getByText('submitted their attempt')).toBeInTheDocument();
  });
});
