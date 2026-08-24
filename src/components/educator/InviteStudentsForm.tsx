'use client';

import { useState, useTransition } from 'react';
import { inviteStudents } from '@/app/educator/actions';

interface InviteStudentsFormProps {
  portalId: string;
  schoolId: string;
  schoolName: string;
}

export default function InviteStudentsForm({
  portalId,
  schoolId,
  schoolName,
}: InviteStudentsFormProps) {
  const [emails, setEmails] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function addEmail() {
    const email = newEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    if (emails.includes(email)) {
      setNewEmail('');
      return;
    }
    setEmails((prev) => [...prev, email]);
    setNewEmail('');
  }

  function removeEmail(index: number) {
    setEmails((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(formData: FormData) {
    setError(null);
    setSuccess(null);

    formData.set('portalId', portalId);
    formData.set('schoolId', schoolId);
    emails.forEach((email) => formData.append('studentEmails', email));

    startTransition(async () => {
      const result = await inviteStudents(formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setSuccess(
          `${result.count} student${result.count !== 1 ? 's' : ''} invited successfully!`
        );
        setEmails([]);
      }
    });
  }

  return (
    <form
      action={handleSubmit}
      style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
    >
      {error && (
        <div className="form-error" style={{ marginBottom: 0 }}>
          {error}
        </div>
      )}
      {success && (
        <div
          style={{
            background: 'rgba(16, 185, 129, 0.1)',
            color: 'var(--success-color)',
            padding: '0.5rem 0.75rem',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid rgba(16, 185, 129, 0.2)',
            fontSize: '0.85rem',
          }}
        >
          {success}
        </div>
      )}

      {/* Email tags */}
      {emails.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
          {emails.map((email, i) => (
            <span
              key={i}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.2rem 0.5rem',
                background: 'rgba(99, 102, 241, 0.1)',
                border: '1px solid rgba(99, 102, 241, 0.2)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.8rem',
                color: 'var(--text-primary)',
              }}
            >
              {email}
              <button
                type="button"
                onClick={() => removeEmail(i)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  lineHeight: 1,
                  padding: 0,
                  fontFamily: 'inherit',
                }}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Email input + add button */}
      <div style={{ display: 'flex', gap: '0.4rem' }}>
        <input
          className="input-field"
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addEmail();
            }
          }}
          placeholder="student@email.com"
          style={{ flex: 1, fontSize: '0.85rem', padding: '0.5rem 0.75rem' }}
        />
        <button
          type="button"
          onClick={addEmail}
          className="btn btn-secondary"
          style={{ fontSize: '0.8rem', padding: '0.5rem 0.75rem' }}
        >
          Add
        </button>
      </div>

      {/* Submit */}
      <button
        type="submit"
        className="btn btn-primary"
        disabled={isPending || emails.length === 0}
        style={{
          fontSize: '0.85rem',
          padding: '0.5rem 1rem',
          alignSelf: 'flex-start',
        }}
      >
        {isPending
          ? 'Sending invites...'
          : `Invite ${emails.length} student${emails.length !== 1 ? 's' : ''}`}
      </button>
    </form>
  );
}
