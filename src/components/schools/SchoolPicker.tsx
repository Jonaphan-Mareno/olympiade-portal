'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type {
  PickedSchool,
  SchoolSuggestion,
  SchoolType,
} from '@/lib/schools/types';

const TYPE_LABELS: Record<SchoolType, string> = {
  high_school: 'High school (SA)',
  university: 'University',
};

const TYPE_ORDER: SchoolType[] = ['high_school', 'university'];

async function fetchSuggestions(
  q: string,
  type: SchoolType
): Promise<SchoolSuggestion[]> {
  const res = await fetch(
    `/api/schools/suggest?q=${encodeURIComponent(q)}&type=${type}`
  );
  if (!res.ok) throw new Error(`Suggest request failed: ${res.status}`);
  return res.json();
}

function describeSuggestion(s: SchoolSuggestion): string | null {
  if (s.type === 'university') return s.country ?? null;
  return [s.town, s.province].filter(Boolean).join(', ') || null;
}

type SchoolPickerProps = {
  value: PickedSchool | null;
  onChange: (picked: PickedSchool | null) => void;
  placeholder?: string;
  // Lets the light-styled Create Portal form match its own inputs.
  inputClassName?: string;
  disabled?: boolean;
};

export default function SchoolPicker({
  value,
  onChange,
  placeholder = 'Search for a school…',
  inputClassName,
  disabled = false,
}: SchoolPickerProps) {
  const [type, setType] = useState<SchoolType>('high_school');
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SchoolSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards against out-of-order responses when the query changes quickly.
  const requestSeq = useRef(0);

  // Close the dropdown when clicking outside this picker.
  useEffect(() => {
    function onDocMouseDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  // Debounced search; also re-runs when the school type is toggled.
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setActiveIndex(-1);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    const seq = ++requestSeq.current;

    timerRef.current = setTimeout(async () => {
      try {
        const results = await fetchSuggestions(q, type);
        if (seq !== requestSeq.current) return;
        setSuggestions(results);
        setActiveIndex(results.length > 0 ? 0 : -1);
        setOpen(true);
      } catch {
        if (seq !== requestSeq.current) return;
        setSuggestions([]);
        setActiveIndex(-1);
        setError(
          type === 'university'
            ? 'University search is unavailable right now. Try again in a moment.'
            : 'Search failed. Try again.'
        );
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    }, 250);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, type]);

  function select(suggestion: SchoolSuggestion) {
    onChange({
      name: suggestion.name,
      type: suggestion.type,
      externalId: suggestion.externalId,
    });
    setQuery('');
    setSuggestions([]);
    setActiveIndex(-1);
    setOpen(false);
    setError(null);
  }

  function changeSelection() {
    onChange(null);
    setSuggestions([]);
    setActiveIndex(-1);
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (suggestions.length === 0) return;
      setOpen(true);
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      if (open && activeIndex >= 0 && suggestions[activeIndex]) {
        event.preventDefault();
        select(suggestions[activeIndex]);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  // A completed selection: show it as a removable choice instead of an input.
  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 border border-slate-300 bg-slate-50 rounded-md p-3">
        <div className="min-w-0">
          <span className="block font-medium text-slate-900 truncate">
            {value.name}
          </span>
          <span className="text-xs text-slate-500">
            {TYPE_LABELS[value.type]}
          </span>
        </div>
        <button
          type="button"
          onClick={changeSelection}
          disabled={disabled}
          className="shrink-0 text-sm font-medium text-blue-600 hover:text-blue-800 transition-colors"
        >
          Change
        </button>
      </div>
    );
  }

  const showDropdown = open && (loading || !!error || suggestions.length > 0 || query.trim().length >= 2);

  return (
    <div ref={containerRef} className="relative">
      {/* School type toggle */}
      <div
        className="flex gap-1 mb-2"
        role="tablist"
        aria-label="School type"
      >
        {TYPE_ORDER.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={type === t}
            disabled={disabled}
            onClick={() => {
              setType(t);
              setOpen(true);
            }}
            className={`px-3 py-1 text-xs font-semibold rounded-md border transition-colors ${
              type === t
                ? 'bg-blue-900 text-white border-blue-900'
                : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
            }`}
          >
            {TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      <input
        type="text"
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={listboxId}
        aria-autocomplete="list"
        autoComplete="off"
        className={
          inputClassName ??
          'w-full border border-slate-300 rounded-md p-3 text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all bg-white'
        }
        value={query}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
      />

      {showDropdown && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute top-full left-0 right-0 z-50 bg-white border border-slate-200 rounded-md mt-1 max-h-60 overflow-y-auto shadow-lg"
        >
          {error && (
            <div className="px-4 py-3 text-sm text-red-600">{error}</div>
          )}
          {!error && loading && (
            <div className="px-4 py-3 text-sm text-slate-500">Searching…</div>
          )}
          {!error && !loading && suggestions.length === 0 && (
            <div className="px-4 py-3 text-sm text-slate-500">
              No matches. Check the spelling or switch school type.
            </div>
          )}
          {suggestions.map((s, i) => (
            <button
              key={`${s.type}-${s.externalId ?? s.name}-${i}`}
              type="button"
              role="option"
              aria-selected={i === activeIndex}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => select(s)}
              className={`block w-full text-left px-4 py-2 transition-colors ${
                i === activeIndex ? 'bg-slate-100' : 'hover:bg-slate-50'
              }`}
            >
              <span className="block text-slate-900">{s.name}</span>
              {describeSuggestion(s) && (
                <span className="block text-xs text-slate-500">
                  {describeSuggestion(s)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
