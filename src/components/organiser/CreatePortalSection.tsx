'use client';

import { useState } from 'react';
import CreatePortalForm from './CreatePortalForm';

export default function CreatePortalSection() {
  const [showForm, setShowForm] = useState(false);

  if (showForm) {
    return (
      <div className="glass-panel" style={{ padding: '1.5rem', marginTop: '1.5rem' }}>
        <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>Create New Olympiad</h3>
        <CreatePortalForm onClose={() => setShowForm(false)} />
      </div>
    );
  }

  return (
    <button
      className="btn btn-primary"
      style={{ marginTop: '1rem' }}
      onClick={() => setShowForm(true)}
    >
      Create New Olympiad
    </button>
  );
}
