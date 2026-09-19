'use client';

import { useState, useTransition } from 'react';
import { inviteStudents } from '@/app/educator/actions';
import { Spinner } from '@/components/ui/Spinner';

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
        <div
          style={{
            backgroundColor: '#FEE2E2',
            color: '#DC2626',
            padding: '0.5rem 0.75rem',
            borderRadius: '0.375rem',
            border: '1px solid #F87171',
            fontSize: '0.85rem',
            marginBottom: 0,
          }}
        >
          {error}
        </div>
      )}
      {success && (
        <div
          style={{
            background: '#DCFCE7',
            color: '#166534',
            padding: '0.5rem 0.75rem',
            borderRadius: '0.375rem',
            border: '1px solid #BBF7D0',
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
                background: '#EFF6FF',
                border: '1px solid #BFDBFE',
                borderRadius: '0.375rem',
                fontSize: '0.8rem',
                color: '#1E40AF',
              }}
            >
              {email}
              <button
                type="button"
                onClick={() => removeEmail(i)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#64748B',
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
          style={{
            flex: 1,
            fontSize: '0.85rem',
            padding: '0.5rem 0.75rem',
            background: '#FFFFFF',
            border: '1px solid #CBD5E1',
            borderRadius: '0.375rem',
            color: '#0F172A',
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={addEmail}
          style={{
            fontSize: '0.8rem',
            padding: '0.5rem 0.75rem',
            backgroundColor: 'transparent',
            border: '1px solid #0066CC',
            color: '#0066CC',
            borderRadius: '0.375rem',
            fontWeight: '500',
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'all 0.2s',
          }}
          onMouseOver={(e) =>
            (e.currentTarget.style.backgroundColor = '#EFF6FF')
          }
          onMouseOut={(e) =>
            (e.currentTarget.style.backgroundColor = 'transparent')
          }
        >
          Add
        </button>
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={isPending || emails.length === 0}
        style={{
          fontSize: '0.85rem',
          padding: '0.5rem 1rem',
          backgroundColor: '#0066CC',
          color: '#FFFFFF',
          border: 'none',
          borderRadius: '0.375rem',
          fontWeight: '500',
          cursor: isPending || emails.length === 0 ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit',
          alignSelf: 'flex-start',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5rem',
          opacity: isPending || emails.length === 0 ? 0.6 : 1,
          transition: 'background-color 0.2s',
        }}
        onMouseOver={(e) => {
          if (!(isPending || emails.length === 0)) {
            e.currentTarget.style.backgroundColor = '#004C99';
          }
        }}
        onMouseOut={(e) => {
          if (!(isPending || emails.length === 0)) {
            e.currentTarget.style.backgroundColor = '#0066CC';
          }
        }}
      >
        {isPending ? (
          <>
            <Spinner /> Sending invites...
          </>
        ) : (
          `Invite ${emails.length} student${emails.length !== 1 ? 's' : ''}`
        )}
      </button>
    </form>
  );
}
