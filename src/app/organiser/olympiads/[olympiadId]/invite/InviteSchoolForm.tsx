'use client';

import { useState, useTransition, useRef, useEffect, useCallback } from 'react';
import { sendInvitations } from './actions';
import Link from 'next/link';

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
  const res = await fetch(
    `/api/schools/search?q=${encodeURIComponent(q.trim())}`
  );
  if (!res.ok) return [];
  return res.json();
}

export default function InviteSchoolForm({ portalId }: { portalId: string }) {
  const [entries, setEntries] = useState<SchoolEntry[]>([emptyEntry()]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const searchTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map()
  );

  // Close suggestions when clicking outside
  useEffect(() => {
    function handleClick() {
      setEntries((prev) => prev.map((e) => ({ ...e, showSuggestions: false })));
    }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const updateEntry = useCallback(
    (index: number, patch: Partial<SchoolEntry>) => {
      setEntries((prev) =>
        prev.map((e, i) => (i === index ? { ...e, ...patch } : e))
      );
    },
    []
  );

  function onQueryChange(index: number, value: string) {
    updateEntry(index, {
      query: value,
      existingId: null,
      showSuggestions: true,
    });

    // Debounce search
    const existing = searchTimers.current.get(index);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      const results = await fetchSchools(value);
      setEntries((prev) =>
        prev.map((e, i) =>
          i === index
            ? {
                ...e,
                suggestions: results,
                showSuggestions: results.length > 0,
              }
            : e
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
    setEntries((prev) => [...prev, emptyEntry()]);
  }

  function removeSchool(index: number) {
    setEntries((prev) => prev.filter((_, i) => i !== index));
  }

  function addTeacherEmail(index: number) {
    setEntries((prev) =>
      prev.map((e, i) => {
        if (i !== index) return e;
        const email = e.newTeacherEmail.trim().toLowerCase();
        if (!email || !email.includes('@')) return e;
        if (e.teacherEmails.includes(email))
          return { ...e, newTeacherEmail: '' };
        return {
          ...e,
          teacherEmails: [...e.teacherEmails, email],
          newTeacherEmail: '',
        };
      })
    );
  }

  function removeTeacherEmail(schoolIndex: number, emailIndex: number) {
    setEntries((prev) =>
      prev.map((e, i) =>
        i === schoolIndex
          ? {
              ...e,
              teacherEmails: e.teacherEmails.filter(
                (_, ei) => ei !== emailIndex
              ),
            }
          : e
      )
    );
  }

  async function handleSubmit(formData: FormData) {
    setError(null);

    formData.set('schoolCount', String(entries.length));

    entries.forEach((entry, i) => {
      if (entry.existingId) {
        formData.set(`school_existingId_${i}`, entry.existingId);
      } else {
        formData.set(`school_newName_${i}`, entry.query.trim());
      }
      entry.teacherEmails.forEach((email) => {
        formData.append(`school_teacherEmails_${i}`, email);
      });
    });

    startTransition(async () => {
      const result = await sendInvitations(portalId, formData);
      if (result?.error) {
        setError(result.error);
      }
    });
  }

  return (
    <form action={handleSubmit} className="w-full">
      {error && (
        <div className="bg-red-50 text-red-900 p-4 rounded-md mb-6 border border-red-100 font-medium">
          {error}
        </div>
      )}

      <div className="flex flex-col">
        {entries.map((entry, index) => (
          <div
            key={index}
            className="py-8 px-6 border-b border-slate-200 bg-white"
          >
            <div className="max-w-4xl mx-auto flex flex-col md:flex-row gap-8">
              {/* School Details */}
              <div className="flex-1">
                <label className="block font-serif text-xl font-bold text-slate-900 mb-2">
                  School Name
                </label>
                <div className="relative" onClick={(e) => e.stopPropagation()}>
                  <input
                    className="w-full border border-slate-300 rounded-md p-3 text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all bg-white"
                    type="text"
                    value={entry.query}
                    onChange={(e) => onQueryChange(index, e.target.value)}
                    onFocus={() => {
                      if (entry.suggestions.length > 0 && !entry.existingId) {
                        updateEntry(index, { showSuggestions: true });
                      }
                    }}
                    placeholder={`e.g. St. Patrick's High School`}
                  />
                  {entry.existingId && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[0.7rem] px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-sm border border-indigo-200">
                      existing
                    </span>
                  )}
                  {/* Suggestions dropdown */}
                  {entry.showSuggestions &&
                    entry.suggestions.length > 0 &&
                    !entry.existingId && (
                      <div className="absolute top-full left-0 right-0 z-50 bg-white border border-slate-200 rounded-md mt-1 max-h-48 overflow-y-auto shadow-lg">
                        {entry.suggestions.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => selectSuggestion(index, s)}
                            className="block w-full text-left px-4 py-2 hover:bg-slate-50 text-slate-900 transition-colors"
                          >
                            {s.name}
                          </button>
                        ))}
                      </div>
                    )}
                </div>
              </div>

              {/* Teacher emails */}
              <div className="flex-1">
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Teachers / Educators
                </label>

                {/* Existing teacher email tags */}
                {entry.teacherEmails.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {entry.teacherEmails.map((email, ei) => (
                      <span
                        key={ei}
                        className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded-md"
                      >
                        {email}
                        <button
                          type="button"
                          onClick={() => removeTeacherEmail(index, ei)}
                          className="hover:bg-blue-200 rounded-full p-0.5 transition-colors flex items-center justify-center outline-none"
                        >
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                          </svg>
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Add teacher email input */}
                <div className="flex gap-2">
                  <input
                    className="flex-1 border border-slate-300 rounded-md p-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"
                    type="email"
                    value={entry.newTeacherEmail}
                    onChange={(e) =>
                      updateEntry(index, { newTeacherEmail: e.target.value })
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addTeacherEmail(index);
                      }
                    }}
                    placeholder="educator@school.edu"
                  />
                  <button
                    type="button"
                    onClick={() => addTeacherEmail(index)}
                    className="bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 px-4 py-2 rounded-md text-sm font-medium transition-colors"
                  >
                    Add
                  </button>
                </div>

                {entries.length > 1 && (
                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={() => removeSchool(index)}
                      className="text-red-600 hover:text-red-700 text-sm font-medium transition-colors"
                    >
                      Remove School
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6 border-b border-slate-200">
        <button
          type="button"
          onClick={addSchool}
          className="flex items-center gap-2 text-blue-600 hover:text-blue-800 font-semibold transition-colors text-sm"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          Add Another School
        </button>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-10 flex justify-end items-center">
        <button
          type="submit"
          disabled={isPending}
          className="bg-blue-900 hover:bg-blue-800 text-white font-bold py-3 px-8 rounded-md transition-colors"
        >
          {isPending ? 'Sending...' : 'Send Invitations'}
        </button>
      </div>
    </form>
  );
}
