'use client';

import { useState } from 'react';

export default function RoundFormInputs({
  defaultOpensAt = '',
  defaultClosesAt = '',
  defaultDuration = 60,
  isOnline = false,
}: {
  defaultOpensAt?: string;
  defaultClosesAt?: string;
  defaultDuration?: number;
  isOnline?: boolean;
}) {
  const [opensAt, setOpensAt] = useState(defaultOpensAt);
  const [closesAt, setClosesAt] = useState(defaultClosesAt);
  const [error, setError] = useState<string | null>(null);

  const handleClosesAtChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setClosesAt(e.target.value);
    if (opensAt && new Date(e.target.value) <= new Date(opensAt)) {
      setError('Closing time must be after the opening time.');
      e.target.setCustomValidity('Closing time must be after the opening time.');
    } else {
      setError(null);
      e.target.setCustomValidity('');
    }
  };

  const handleOpensAtChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setOpensAt(e.target.value);
    if (closesAt && new Date(closesAt) <= new Date(e.target.value)) {
      setError('Closing time must be after the opening time.');
      const closesInput = document.getElementById('closesAt') as HTMLInputElement;
      if (closesInput) closesInput.setCustomValidity('Closing time must be after the opening time.');
    } else {
      setError(null);
      const closesInput = document.getElementById('closesAt') as HTMLInputElement;
      if (closesInput) closesInput.setCustomValidity('');
    }
  };

  return (
    <>
      <div className="md:col-span-1">
        <label className="block text-sm font-semibold text-slate-900 mb-2" htmlFor="opensAt">Opening Time</label>
        <input type="datetime-local" id="opensAt" name="opensAt" required value={opensAt} onChange={handleOpensAtChange} className="w-full p-3 border border-slate-300 rounded-md text-slate-900 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" />
      </div>
      {isOnline && (
        <div className="md:col-span-1">
          <label className="block text-sm font-semibold text-slate-900 mb-2" htmlFor="durationMinutes">Test Time Limit (minutes)</label>
          <input type="number" id="durationMinutes" name="durationMinutes" min="1" max="1440" required defaultValue={defaultDuration} className="w-full p-3 border border-slate-300 rounded-md text-slate-900 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" />
        </div>
      )}
      <div className="md:col-span-1">
        <label className="block text-sm font-semibold text-slate-900 mb-2" htmlFor="closesAt">Closing Time</label>
        <input type="datetime-local" id="closesAt" name="closesAt" required value={closesAt} onChange={handleClosesAtChange} className="w-full p-3 border border-slate-300 rounded-md text-slate-900 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" />
        {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
      </div>
    </>
  );
}
