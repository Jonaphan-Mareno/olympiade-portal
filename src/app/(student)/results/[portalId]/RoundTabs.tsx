'use client';

import { useState } from 'react';

type Round = {
  id: string;
  name: string;
  opensAt: Date | null;
  closesAt: Date | null;
  qualifyingThreshold: string | null;
};

export default function RoundTabs({ rounds }: { rounds: Round[] }) {
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(
    rounds.length > 0 ? rounds[0].id : null
  );

  if (rounds.length === 0) {
    return (
      <p style={{ color: '#64748B', fontSize: '1rem', fontStyle: 'italic', marginTop: '2rem' }}>
        There are currently no rounds available for this Olympiad.
      </p>
    );
  }

  const selectedRound = rounds.find((r) => r.id === selectedRoundId);

  return (
    <div style={{ marginTop: '2rem' }}>
      <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid #E2E8F0', paddingBottom: '0.5rem', overflowX: 'auto', marginBottom: '2rem' }}>
        {rounds.map((round) => (
          <button
            key={round.id}
            onClick={() => setSelectedRoundId(round.id)}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: selectedRoundId === round.id ? '#0066CC' : 'transparent',
              color: selectedRoundId === round.id ? '#FFFFFF' : '#475569',
              border: 'none',
              borderRadius: '0.375rem',
              fontWeight: '600',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.2s',
            }}
          >
            {round.name}
          </button>
        ))}
      </div>

      {selectedRound && (
        <div style={{ backgroundColor: '#FFFFFF', padding: '1.5rem', borderRadius: '0.75rem', border: '1px solid #E2E8F0', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#1E293B', marginBottom: '1.5rem' }}>
            {selectedRound.name} Details
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem', fontSize: '1rem', color: '#475569' }}>
            <div>
              <strong style={{ display: 'block', color: '#334155', marginBottom: '0.5rem', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Opens At</strong>
              {selectedRound.opensAt ? new Date(selectedRound.opensAt).toLocaleString() : 'Not set'}
            </div>
            <div>
              <strong style={{ display: 'block', color: '#334155', marginBottom: '0.5rem', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Closes At</strong>
              {selectedRound.closesAt ? new Date(selectedRound.closesAt).toLocaleString() : 'Not set'}
            </div>
            {selectedRound.qualifyingThreshold && (
              <div>
                <strong style={{ display: 'block', color: '#334155', marginBottom: '0.5rem', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Qualifying Threshold</strong>
                {selectedRound.qualifyingThreshold}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
