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
  console.log("CreatePortalForm rendered - hot reload test");
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
      <div className="p-6 text-center flex flex-col items-center justify-center h-full">
        <div className="bg-emerald-50 text-emerald-600 p-4 rounded-lg border border-emerald-100 mb-6 font-medium">
          Portal created successfully!
        </div>
        {onClose && (
          <button type="button" className="bg-slate-100 hover:bg-slate-200 text-slate-900 font-medium py-2.5 px-6 rounded-lg transition-colors border-none cursor-pointer" onClick={onClose}>
            Close
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <style>{`
        .light-form { display: flex; flex-direction: column; gap: 1.25rem; width: 100%; max-width: 42rem; margin: 0 auto; padding: 1rem 0; }
        .light-label { font-size: 0.875rem; font-weight: 600; color: #334155; display: block; margin-bottom: 0.25rem; }
        .light-input { width: 100%; border: 1px solid #CBD5E1; border-radius: 0.5rem; padding: 0.75rem; color: #0F172A; outline: none; transition: all 0.2s; background: #FFF; font-family: inherit; font-size: 1rem; }
        .light-input:focus { border-color: #0066CC; box-shadow: 0 0 0 2px rgba(0, 102, 204, 0.2); }
        .light-btn { display: inline-flex; align-items: center; justify-content: center; padding: 0.625rem 1.25rem; border-radius: 0.5rem; font-family: inherit; font-weight: 500; font-size: 0.875rem; cursor: pointer; transition: all 0.2s; border: none; outline: none; }
        .btn-blue { background: #0066CC; color: white; }
        .btn-blue:hover { background: #004C99; }
        .btn-ghost { background: transparent; color: #475569; }
        .btn-ghost:hover { background: #F1F5F9; }
        .btn-white { background: #FFF; border: 1px solid #CBD5E1; color: #334155; }
        .btn-white:hover { background: #F8FAFC; }
      `}</style>
      <form action={handleSubmit} className="light-form">
      {error && <div className="bg-red-50 text-red-900 p-3 rounded-lg text-sm border border-red-100">{error}</div>}

      {/* Portal Name */}
      <div className="flex flex-col gap-1.5">
        <label className="light-label text-slate-700" htmlFor="portalName">
          Olympiad / Portal Name
        </label>
        <input
          className="light-input text-slate-900"
          type="text"
          name="portalName"
          id="portalName"
          placeholder="e.g. National Mathematics Olympiad"
          required
        />
      </div>

      {/* Schools */}
      <div>
        <label className="text-sm font-semibold text-slate-700 block mb-3">
          Schools
        </label>
        <div className="flex flex-col gap-4">
          {entries.map((entry, index) => (
            <div
              key={index}
              style={{ padding: "1.25rem", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "0.75rem" }}
            >
              {/* School name with autocomplete */}
              <div style={{ position: 'relative', marginBottom: '0.75rem' }} onClick={(e) => e.stopPropagation()}>
                <input
                  className="light-input text-slate-900"
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
                    background: '#FFFFFF',
                    border: '1px solid #E2E8F0',
                    borderRadius: '0.5rem',
                    marginTop: '0.25rem',
                    maxHeight: '200px',
                    overflowY: 'auto',
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.1)',
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
                          color: '#0F172A',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          fontSize: '0.9rem',
                          transition: 'background 0.15s',
                        }}
                        onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#F1F5F9'; }}
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
                <span className="text-sm font-semibold text-slate-700 block mb-2 mt-4">
                  Teachers / Educators
                </span>

                {/* Existing teacher email tags */}
                {entry.teacherEmails.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3 mb-2">
                    {entry.teacherEmails.map((email, ei) => (
                      <span
                        key={ei}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#0066CC]/10 text-[#0066CC] text-xs font-medium"
                      >
                        {email}
                        <button
                          type="button"
                          onClick={() => removeTeacherEmail(index, ei)}
                          className="hover:bg-[#0066CC]/20 rounded-full p-0.5 transition-colors flex items-center justify-center outline-none"
                          aria-label={`Remove ${email}`}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                          </svg>
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Add teacher email input */}
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input
                    className="light-input text-slate-900" style={{ flex: 1 }}
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
                  />
                  <button
                    type="button"
                    onClick={() => addTeacherEmail(index)}
                    className="light-btn btn-white"
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
                  className="text-link-danger"
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
          className="text-link-blue"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          Add School
        </button>
      </div>

      {/* Action Footer */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", paddingTop: "1rem", borderTop: "1px solid #F1F5F9" }}>
        {onClose && (
          <button type="button" className="light-btn btn-ghost text-slate-700" onClick={onClose}>
            Cancel
          </button>
        )}
        <button type="submit" className="light-btn btn-blue text-white" disabled={isPending}>
          {isPending ? 'Creating...' : 'Create Portal'}
        </button>
      </div>
    </form>
    </>
  );
}
