import '@testing-library/jest-dom';

// jsdom doesn't implement IntersectionObserver, which ExamInterface uses to
// track which questions the student has seen. A no-op stub keeps component
// tests rendering instead of throwing a ReferenceError.
if (!('IntersectionObserver' in globalThis)) {
  class IntersectionObserverStub {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: readonly number[] = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }

  (globalThis as unknown as Record<string, unknown>).IntersectionObserver =
    IntersectionObserverStub;
}
