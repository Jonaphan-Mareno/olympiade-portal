'use client';

import { useState, useTransition, useRef, useEffect, useCallback } from 'react';
import { createPortal } from '@/app/organiser/actions';

type SchoolSuggestion = { id: string; name: string };

type SchoolEntry = {
  query: string;
  existingId: string | null;
  suggestions: SchoolSuggestion[];
  showSuggestions: boolean;
  teacherEmails: string[];
  newTeacherEmail: string;
};

function emptyEntry(): SchoolEntry {
  return {
    query: '',
    existingId: null,
    suggestions: [],
    showSuggestions: false,
    teacherEmails: [],
    newTeacherEmail: '',
  };
}

async function fetchSchools(q: string): Promise<SchoolSuggestion[]> {
  if (q.trim().length < 2) return [];
  const res = await fetch(`/api/schools/search?q=${encodeURIComponent(q.trim())}`);
  if (!res.ok) return [];
  return res.json();
}

export default function CreatePortalForm({ onClose }: { onClose?: () => void }) {
  const [entries, setEntries] = useState<SchoolEntry[]>([emptyEntry()]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();
  const searchTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  // Close suggestions when clicking outside
  useEffect(() => {
    function handleClick() {
      setEntries(prev => prev.map(e => ({ ...e, showSuggestions: false })));
    }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const updateEntry = useCallback((index: number, patch: Partial<SchoolEntry>) => {
    setEntries(prev => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }, []);

  function onQueryChange(index: number, value: string) {
    updateEntry(index, { query: value, existingId: null, showSuggestions: true });

    // Debounce search
    const existing = searchTimers.current.get(index);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      const results = await fetchSchools(value);
      setEntries(prev =>
        prev.map((e, i) =>
          i === index ? { ...e, suggestions: results, showSuggestions: results.length > 0 } : e
        )
      );
    }, 250);
    searchTimers.current.set(index, timer);
  }

  function selectSuggestion(index: number, suggestion: SchoolSuggestion) {
    updateEntry(index, {
      query: suggestion.name,
      existingId: suggestion.id,
      suggestions: [],
      showSuggestions: false,
    });
  }

  function addSchool() {
    setEntries(prev => [...prev, emptyEntry()]);
  }

  function removeSchool(index: number) {
    setEntries(prev => prev.filter((_, i) => i !== index));
  }

  function addTeacherEmail(index: number) {
    setEntries(prev =>
      prev.map((e, i) => {
        if (i !== index) return e;
        const email = e.newTeacherEmail.trim().toLowerCase();
        if (!email || !email.includes('@')) return e;
        if (e.teacherEmails.includes(email)) return { ...e, newTeacherEmail: '' };
        return {
          ...e,
          teacherEmails: [...e.teacherEmails, email],
          newTeacherEmail: '',
        };
      })
    );
  }

  function removeTeacherEmail(schoolIndex: number, emailIndex: number) {
    setEntries(prev =>
      prev.map((e, i) =>
        i === schoolIndex
          ? { ...e, teacherEmails: e.teacherEmails.filter((_, ei) => ei !== emailIndex) }
          : e
      )
    );
  }

  async function handleSubmit(formData: FormData) {
    setError(null);
    setSuccess(false);

    // Build structured form data for schools
    formData.set('schoolCount', String(entries.length));

    entries.forEach((entry, i) => {
      if (entry.existingId) {
        formData.set(`school_existingId_${i}`, entry.existingId);
      } else {
        formData.set(`school_newName_${i}`, entry.query.trim());
      }
      entry.teacherEmails.forEach(email => {
        formData.append(`school_teacherEmails_${i}`, email);
      });
    });

    startTransition(async () => {
      const result = await createPortal(formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setSuccess(true);
        setEntries([emptyEntry()]);
        if (onClose) onClose();
      }
    });
  }

  if (success) {
    return (
      <div style={{ padding: '1.5rem', textAlign: 'center' }}>
        <div style={{
          background: 'rgba(16, 185, 129, 0.1)',
          color: 'var(--success-color)',
          padding: '1rem',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid rgba(16, 185, 129, 0.2)',
          marginBottom: '1rem',
        }}>
          Portal created successfully!
        </div>
        {onClose && (
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        )}
      </div>
    );
  }

  return (
    <form action={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {error && <div className="form-error">{error}</div>}

      {/* Portal Name */}
      <div className="input-group">
        <label className="input-label" htmlFor="portalName">
          Olympiad / Portal Name
        </label>
        <input
          className="input-field"
          type="text"
          name="portalName"
          id="portalName"
          placeholder="e.g. National Mathematics Olympiad"
          required
        />
      </div>

      {/* Schools */}
      <div>
        <label className="input-label" style={{ marginBottom: '0.75rem', display: 'block' }}>
          Schools
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {entries.map((entry, index) => (
            <div
              key={index}
              style={{
                padding: '1rem',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              {/* School name with autocomplete */}
              <div style={{ position: 'relative', marginBottom: '0.75rem' }} onClick={(e) => e.stopPropagation()}>
                <input
                  className="input-field"
                  type="text"
                  value={entry.query}
                  onChange={(e) => onQueryChange(index, e.target.value)}
                  onFocus={() => {
                    if (entry.suggestions.length > 0 && !entry.existingId) {
                      updateEntry(index, { showSuggestions: true });
                    }
                  }}
                  placeholder={`School ${index + 1} — start typing to search existing schools`}
                />
                {entry.existingId && (
                  <span style={{
                    position: 'absolute',
                    right: '0.75rem',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    fontSize: '0.7rem',
                    padding: '0.15rem 0.5rem',
                    background: 'rgba(99, 102, 241, 0.15)',
                    color: 'var(--primary-color)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid rgba(99, 102, 241, 0.3)',
                  }}>
                    existing
                  </span>
                )}
                {/* Suggestions dropdown */}
                {entry.showSuggestions && entry.suggestions.length > 0 && !entry.existingId && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    zIndex: 50,
                    background: 'var(--bg-secondary)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: 'var(--radius-sm)',
                    marginTop: '0.25rem',
                    maxHeight: '200px',
                    overflowY: 'auto',
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
                  }}>
                    {entry.suggestions.map(s => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => selectSuggestion(index, s)}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          padding: '0.6rem 1rem',
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text-primary)',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          fontSize: '0.9rem',
                          transition: 'background 0.15s',
                        }}
                        onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'rgba(99, 102, 241, 0.1)'; }}
                        onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Teacher emails */}
              <div>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem' }}>
                  Teachers / Educators
                </span>

                {/* Existing teacher email tags */}
                {entry.teacherEmails.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.5rem' }}>
                    {entry.teacherEmails.map((email, ei) => (
                      <span
                        key={ei}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          padding: '0.25rem 0.6rem',
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
                          onClick={() => removeTeacherEmail(index, ei)}
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

                {/* Add teacher email input */}
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <input
                    className="input-field"
                    type="email"
                    value={entry.newTeacherEmail}
                    onChange={(e) => updateEntry(index, { newTeacherEmail: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addTeacherEmail(index);
                      }
                    }}
                    placeholder="teacher@email.com"
                    style={{ flex: 1, fontSize: '0.875rem', padding: '0.5rem 0.75rem' }}
                  />
                  <button
                    type="button"
                    onClick={() => addTeacherEmail(index)}
                    className="btn btn-secondary"
                    style={{ fontSize: '0.8rem', padding: '0.5rem 0.75rem' }}
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Remove school button */}
              {entries.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeSchool(index)}
                  style={{
                    marginTop: '0.75rem',
                    background: 'none',
                    border: 'none',
                    color: 'var(--danger-color)',
                    cursor: 'pointer',
                    fontSize: '0.8rem',
                    fontFamily: 'inherit',
                    opacity: 0.7,
                    transition: 'opacity 0.2s',
                  }}
                  onMouseEnter={(e) => { (e.target as HTMLElement).style.opacity = '1'; }}
                  onMouseLeave={(e) => { (e.target as HTMLElement).style.opacity = '0.7'; }}
                >
                  Remove this school
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addSchool}
          className="btn btn-secondary"
          style={{ marginTop: '0.75rem', fontSize: '0.875rem', padding: '0.5rem 1rem' }}
        >
          + Add School
        </button>
      </div>

      {/* Submit */}
      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button type="submit" className="btn btn-primary" disabled={isPending}>
          {isPending ? 'Creating...' : 'Create Portal'}
        </button>
        {onClose && (
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
