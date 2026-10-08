/**
 * Single metric card matching the stat cards on the educator overview
 * (uppercase slate label, large bold value, #E2E8F0 border) so every
 * dashboard reads consistently. Server-rendered — no client JS.
 */
export default function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div
      className="hover:border-blue-300 transition-all duration-200 bg-white"
      style={{
        padding: '1.5rem',
        border: '1px solid #E2E8F0',
        borderRadius: '0.5rem',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
      }}
    >
      <span className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-1">
        {label}
      </span>
      <span className="text-3xl font-bold text-slate-900">{value}</span>
      {sub && <span className="text-xs text-slate-400 mt-1">{sub}</span>}
    </div>
  );
}
