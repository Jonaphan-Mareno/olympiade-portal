'use client';

import { useState } from 'react';

// Shown only below the md breakpoint (768px): the portal's dashboards, question
// builder and exam views are designed for laptop/desktop/tablet screens.
export function SmallScreenNotice() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div
      role="note"
      className="md:hidden fixed top-0 inset-x-0 z-50 flex items-start gap-3 bg-amber-50 border-b border-amber-300 px-4 py-3 text-sm text-amber-900 shadow-sm"
    >
      <p className="flex-1 m-0 leading-snug">
        <strong>Small screen detected.</strong> For the best experience, please
        use a laptop, desktop or tablet. Some parts of the portal may not work
        properly on a phone.
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss small screen notice"
        className="shrink-0 text-amber-900 text-lg leading-none px-1"
      >
        &times;
      </button>
    </div>
  );
}
