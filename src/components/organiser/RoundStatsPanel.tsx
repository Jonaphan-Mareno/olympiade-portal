import type { RoundStats } from '@/domain/rounds/round-stats';
import StatCard from '@/components/ui/StatCard';

/**
 * Read-only statistics for one round, rendered as a card grid. Mirrors the
 * stat cards on the educator overview (uppercase slate label, large bold
 * value, #E2E8F0 border) so the organiser console feels consistent with the
 * rest of the app. Server-rendered — no client JS.
 */
export default function RoundStatsPanel({
  stats,
  totalMarks,
}: {
  stats: RoundStats;
  totalMarks: number;
}) {
  const completionRate =
    stats.wrote > 0
      ? Math.round((stats.completed / stats.wrote) * 100)
      : null;

  const averageDisplay =
    stats.averagePercentage !== null
      ? `${stats.averagePercentage}%`
      : stats.averageScore !== null
        ? `${stats.averageScore}`
        : '–';

  const averageSub =
    stats.averageScore !== null && totalMarks > 0
      ? `avg ${stats.averageScore} of ${totalMarks} marks`
      : stats.averageScore !== null
        ? 'avg raw marks'
        : 'no marks captured yet';

  const passRateDisplay = stats.passRate !== null ? `${stats.passRate}%` : 'Not set';

  const cards: { label: string; value: string; sub: string }[] = [
    {
      label: 'Registered Entrants',
      value: `${stats.entrants}`,
      sub: 'students in this olympiad',
    },
    {
      label: 'Wrote',
      value: `${stats.wrote}`,
      sub: 'started an attempt',
    },
    {
      label: 'Completed',
      value: `${stats.completed}`,
      sub:
        completionRate !== null
          ? `of ${stats.wrote} who wrote (${completionRate}%)`
          : 'submitted their attempt',
    },
    {
      label: 'Marked',
      value: `${stats.marked}`,
      sub: 'results captured',
    },
    {
      label: 'Average Mark',
      value: averageDisplay,
      sub: averageSub,
    },
    {
      label: 'Pass Rate',
      value: passRateDisplay,
      sub: 'vs qualifying threshold',
    },
    {
      label: 'Advanced In',
      value: `${stats.advanced}`,
      sub: 'qualified from previous round',
    },
  ];

  return (
    <section className="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-slate-200">
      <h2 className="text-xl font-bold text-slate-900 mb-2 border-b border-slate-100 pb-3">
        Round Statistics
      </h2>
      <p className="text-sm text-slate-500 mb-6 mt-4">
        Live participation and marking numbers for this round.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {cards.map((card) => (
          <StatCard
            key={card.label}
            label={card.label}
            value={card.value}
            sub={card.sub}
          />
        ))}
      </div>
    </section>
  );
}
