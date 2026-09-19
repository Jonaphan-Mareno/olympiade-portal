'use client';

import { useState } from 'react';
import { submitOrganiserApplication } from '@/app/organiser/actions';
import { SubmitButton } from '@/components/SubmitButton';

export default function OrganisationApplicationForm() {
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setError(null);
    const result = await submitOrganiserApplication(formData);
    if (result?.error) {
      setError(result.error);
    }
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setIsOpen(true)}
      >
        Submit organiser application
      </button>
    );
  }

  return (
    <form action={handleSubmit} style={{ display: 'grid', gap: '1rem' }}>
      {error && <div className="form-error">{error}</div>}

      <div className="input-group">
        <input
          className="input-field"
          type="text"
          name="organisationName"
          id="organisationName"
          placeholder=" "
          required
        />
        <label className="input-label" htmlFor="organisationName">
          Organisation Name
        </label>
      </div>

      <div className="input-group">
        <textarea
          className="input-field"
          name="purpose"
          id="purpose"
          placeholder=" "
          required
          rows={5}
          style={{ resize: 'vertical', minHeight: '120px' }}
        />
        <label className="input-label" htmlFor="purpose">
          Purpose
        </label>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <SubmitButton
          pendingText="Sending…"
          fullWidth={false}
          className="btn btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
        >
          Send Application
        </SubmitButton>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setIsOpen(false)}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
