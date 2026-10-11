'use client';

import { useRef, useState } from 'react';
import { mergeCsvEmails, type CsvMergeNote } from '@/lib/csv-emails';

// Shared educator email-list field for the organiser invite workflows — the
// Create Portal form and the "invite more schools" form. Educators can be
// typed in one at a time (as before) or bulk-added by uploading a CSV, which
// is parsed in the browser only: the file is never uploaded, saved or stored,
// only the extracted addresses join the list. The quick-add dialog for a
// school that already participates (AddEducatorButton) deliberately keeps its
// manual-only input.

type EducatorEmailsFieldProps = {
  emails: string[];
  onChange: (emails: string[]) => void;
  /** Styling for the host page's text input (e.g. `light-input`). */
  inputClassName: string;
  /** Styling for the host page's secondary buttons (Add / Upload CSV). */
  buttonClassName: string;
  placeholder?: string;
  disabled?: boolean;
};

export default function EducatorEmailsField({
  emails,
  onChange,
  inputClassName,
  buttonClassName,
  placeholder = 'educator@school.edu',
  disabled = false,
}: EducatorEmailsFieldProps) {
  const [newEmail, setNewEmail] = useState('');
  const [note, setNote] = useState<CsvMergeNote | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function addEmail() {
    const email = newEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    setNewEmail('');
    if (emails.includes(email)) return;
    onChange([...emails, email]);
  }

  function removeEmail(index: number) {
    onChange(emails.filter((_, i) => i !== index));
  }

  async function handleCsvFile(file: File) {
    let text: string;
    try {
      text = await file.text();
    } catch {
      setNote({ tone: 'error', text: 'Could not read that file. Please try again.' });
      return;
    }

    const result = mergeCsvEmails(emails, text);
    if (result.emails !== emails) onChange(result.emails);
    setNote(result.note);
  }

  return (
    <div>
      {/* Existing email chips */}
      {emails.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {emails.map((email, index) => (
            <span
              key={`${email}-${index}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#0066CC]/10 text-[#0066CC] text-xs font-medium"
            >
              {email}
              <button
                type="button"
                onClick={() => removeEmail(index)}
                disabled={disabled}
                className="hover:bg-[#0066CC]/20 rounded-full p-0.5 transition-colors flex items-center justify-center outline-none"
                aria-label={`Remove ${email}`}
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

      {/* Manual entry, unchanged: type one address at a time */}
      <div className="flex gap-2">
        <input
          className={`${inputClassName} flex-1`}
          type="email"
          value={newEmail}
          disabled={disabled}
          onChange={(e) => setNewEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addEmail();
            }
          }}
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={addEmail}
          disabled={disabled}
          className={buttonClassName}
        >
          Add
        </button>
      </div>

      {/* Batch add: CSV is read locally, never uploaded or stored */}
      <div className="mt-2 flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className={buttonClassName}
        >
          <span className="inline-flex items-center gap-1.5">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
            Upload CSV
          </span>
        </button>
        <span className="text-xs text-slate-500">
          Bulk-add educators from a CSV file — it is read in your browser and
          never stored.
        </span>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        aria-label="Upload CSV file of educator emails"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Reset so picking the same file again re-triggers onChange.
          e.target.value = '';
          if (file) void handleCsvFile(file);
        }}
      />

      {note && (
        <p
          className={`mt-2 text-xs font-medium ${
            note.tone === 'error' ? 'text-red-600' : 'text-emerald-600'
          }`}
          role="status"
        >
          {note.text}
        </p>
      )}
    </div>
  );
}
