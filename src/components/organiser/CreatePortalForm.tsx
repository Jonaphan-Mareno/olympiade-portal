'use client';

import { useState, useTransition } from 'react';
import { createPortal } from '@/app/organiser/actions';
import SchoolPicker from '@/components/schools/SchoolPicker';
import EducatorEmailsField from '@/components/organiser/EducatorEmailsField';
import { Spinner } from '@/components/ui/Spinner';
import type { PickedSchool } from '@/lib/schools/types';
import { useRouter } from 'next/navigation';

type SchoolEntry = {
  school: PickedSchool | null;
  teacherEmails: string[];
};

function emptyEntry(): SchoolEntry {
  return {
    school: null,
    teacherEmails: [],
  };
}

export default function CreatePortalForm({
  onClose,
}: {
  onClose?: () => void;
}) {
  const router = useRouter();
  const [entries, setEntries] = useState<SchoolEntry[]>([emptyEntry()]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  const updateEntry = (
    index: number,
    patch: Partial<SchoolEntry>
  ) => {
    setEntries((prev) =>
      prev.map((e, i) => (i === index ? { ...e, ...patch } : e))
    );
  };

  function addSchool() {
    setEntries((prev) => [...prev, emptyEntry()]);
  }

  function removeSchool(index: number) {
    setEntries((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(formData: FormData) {
    setError(null);
    setSuccess(false);

    // Build structured form data for schools. Entries without a completed
    // pick from the school picker are skipped, like empty entries before.
    const picked = entries.filter((entry) => entry.school);
    formData.set('schoolCount', String(picked.length));

    picked.forEach((entry, i) => {
      formData.set(`school_name_${i}`, entry.school!.name);
      formData.set(`school_type_${i}`, entry.school!.type);
      if (entry.school!.externalId) {
        formData.set(`school_externalId_${i}`, entry.school!.externalId);
      }
      entry.teacherEmails.forEach((email) => {
        formData.append(`school_teacherEmails_${i}`, email);
      });
    });

    startTransition(async () => {
      const result = await createPortal(formData);
      if (result && 'error' in result && result.error) {
        setError(result.error);
      } else {
        setSuccess(true);
        setEntries([emptyEntry()]);
        if (result && 'portalId' in result && result.portalId) {
          router.push(`/organiser/olympiads/${result.portalId}`);
        } else {
          if (onClose) onClose();
        }
      }
    });
  }

  if (success) {
    return (
      <div className="p-6 text-center flex flex-col items-center justify-center h-full">
        <div className="bg-emerald-50 text-emerald-600 p-4 rounded-lg border border-emerald-100 mb-6 font-medium">
          Olympiad created successfully! Redirecting...
        </div>
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
        {error && (
          <div className="bg-red-50 text-red-900 p-3 rounded-lg text-sm border border-red-100">
            {error}
          </div>
        )}

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
                style={{
                  padding: '1.25rem',
                  background: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                  borderRadius: '0.75rem',
                }}
              >
                {/* School picker (searches the SA high-school directory
                    and the universities API — no free-typed school names) */}
                <div style={{ marginBottom: '0.75rem' }}>
                  <SchoolPicker
                    value={entry.school}
                    onChange={(school) => updateEntry(index, { school })}
                    inputClassName="light-input text-slate-900"
                    placeholder={`School ${index + 1} — pick from the list`}
                  />
                </div>

                {/* Teacher emails — typed one at a time or bulk-added from
                    a CSV file (parsed in the browser, never stored). */}
                <div>
                  <span className="text-sm font-semibold text-slate-700 block mb-2 mt-4">
                    Teachers / Educators
                  </span>
                  <EducatorEmailsField
                    emails={entry.teacherEmails}
                    onChange={(teacherEmails) =>
                      updateEntry(index, { teacherEmails })
                    }
                    inputClassName="light-input text-slate-900"
                    buttonClassName="light-btn btn-white"
                    placeholder="teacher@email.com"
                    disabled={isPending}
                  />
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
          <button type="button" onClick={addSchool} className="text-link-blue">
            <svg
              width="14"
              height="14"
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
            Add School
          </button>
        </div>

        {/* Action Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '0.75rem',
            paddingTop: '1rem',
            borderTop: '1px solid #F1F5F9',
          }}
        >
          {onClose && (
            <button
              type="button"
              className="light-btn btn-ghost text-slate-700"
              onClick={onClose}
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            className="light-btn btn-blue text-white disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2"
            disabled={isPending}
          >
            {isPending ? (
              <>
                <Spinner /> Creating...
              </>
            ) : (
              'Create Portal'
            )}
          </button>
        </div>
      </form>
    </>
  );
}
