'use client';
import { useState } from 'react';

export default function RemarkPanel({ resultId, initialStatus }: { resultId: string; initialStatus: string }) {
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState(initialStatus);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  async function requestRemark() {
    if (reason.trim().length < 5) { setMessage('Please explain why you believe the result should be reviewed.'); return; }
    setSaving(true); setMessage('');
    try {
      const res = await fetch('/api/student/results/remark', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resultId, reason }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not request a remark');
      setStatus('remark_requested'); setMessage('Your remark request has been submitted.');
    } catch (e: any) { setMessage(e.message); } finally { setSaving(false); }
  }
  if (status !== 'moderated' && status !== 'remark_requested') return null;
  return <div className="mt-8 border-t border-slate-200 pt-6"><h3 className="text-lg font-bold text-slate-900">Request a remark</h3>{status === 'remark_requested' ? <p className="mt-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3">A remark has been requested and is awaiting review.</p> : <><p className="text-sm text-slate-600 mt-1">If you believe your result was marked incorrectly, explain why below.</p><textarea value={reason} onChange={e => setReason(e.target.value)} rows={4} className="mt-3 w-full border border-slate-300 rounded-md p-3" placeholder="Explain which part of the marking you believe should be reconsidered…" /><button onClick={requestRemark} disabled={saving} className="mt-3 bg-blue-700 disabled:bg-slate-300 text-white font-semibold px-5 py-2.5 rounded-md">{saving ? 'Submitting…' : 'Request remark'}</button>{message && <p className="mt-3 text-sm text-slate-600">{message}</p>}</>}</div>;
}
