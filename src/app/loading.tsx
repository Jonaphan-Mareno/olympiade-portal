import LoadingIndicator from '@/components/ui/LoadingIndicator';

// Root catch-all: covers cross-section navigations where the changing
// segment sits above any closer loading boundary (e.g. the async admin
// layout's auth check) plus initial hard loads of dynamic pages.
export default function Loading() {
  return <LoadingIndicator label="Loading…" />;
}
