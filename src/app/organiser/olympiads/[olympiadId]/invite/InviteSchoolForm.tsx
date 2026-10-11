'use client';

import { useState, useTransition } from 'react';
import { sendInvitations } from './actions';
import Link from 'next/link';
import SchoolPicker from '@/components/schools/SchoolPicker';
import EducatorEmailsField from '@/components/organiser/EducatorEmailsField';
import { Spinner } from '@/components/ui/Spinner';
import type { PickedSchool } from '@/lib/schools/types';

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

export default function InviteSchoolForm({ portalId }: { portalId: string }) {
  const [entries, setEntries] = useState<SchoolEntry[]>([emptyEntry()]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const updateEntry = (index: number, patch: Partial<SchoolEntry>) => {
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

    // Only entries with a completed pick from the school picker are
    // submitted; typed-but-unpicked text is never saved as a school.
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
                  School
                </label>
                <SchoolPicker
                  value={entry.school}
                  onChange={(school) => updateEntry(index, { school })}
                  placeholder="Search South African high schools or universities…"
                />
              </div>

              {/* Teacher emails — typed one at a time or bulk-added from
                  a CSV file (parsed in the browser, never stored). */}
              <div className="flex-1">
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Teachers / Educators
                </label>

                <EducatorEmailsField
                  emails={entry.teacherEmails}
                  onChange={(teacherEmails) =>
                    updateEntry(index, { teacherEmails })
                  }
                  inputClassName="border border-slate-300 rounded-md p-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"
                  buttonClassName="bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 px-4 py-2 rounded-md text-sm font-medium transition-colors"
                  placeholder="educator@school.edu"
                  disabled={isPending}
                />

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
          className="bg-blue-900 hover:bg-blue-800 disabled:bg-slate-500 disabled:cursor-not-allowed text-white font-bold py-3 px-8 rounded-md transition-colors inline-flex items-center gap-2"
        >
          {isPending ? (
            <>
              <Spinner /> Sending...
            </>
          ) : (
            'Send Invitations'
          )}
        </button>
      </div>
    </form>
  );
}
