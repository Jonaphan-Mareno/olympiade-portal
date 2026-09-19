import { Spinner } from './Spinner';

// Instant route-level loading fallback used by loading.tsx files: gives
// immediate feedback while a dynamic page's server data streams in, so
// link clicks never leave the previous page frozen on screen.
export default function LoadingIndicator({
  label = 'Loading…',
}: {
  label?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-slate-500"
    >
      <Spinner className="h-8 w-8" />
      <p className="text-sm font-medium">{label}</p>
    </div>
  );
}
