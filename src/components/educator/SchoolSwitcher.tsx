'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';

export type SchoolMembership = {
  schoolId: string;
  schoolName: string | null;
};

export default function SchoolSwitcher({ schools, activeSchoolId }: { schools: SchoolMembership[], activeSchoolId?: string }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  // Set the default selection based on the activeSchoolId passed from server,
  // or default to the first school's id if none is found.
  const initialValue = activeSchoolId || (schools.length > 0 ? schools[0].schoolId : '');
  const [selectedSchool, setSelectedSchool] = useState(initialValue);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // If the server didn't have an active school cookie but we defaulted to one,
  // we should set the cookie now so subsequent requests are stable.
  useEffect(() => {
    if (!activeSchoolId && schools.length > 0) {
      document.cookie = `active_school_id=${schools[0].schoolId}; path=/; max-age=31536000`; // 1 year
      router.refresh();
    }
  }, [activeSchoolId, schools, router]);

  const handleSelect = (newSchoolId: string) => {
    setSelectedSchool(newSchoolId);
    setIsOpen(false);
    
    // Set cookie that the server components will read
    document.cookie = `active_school_id=${newSchoolId}; path=/; max-age=31536000`;
    
    // Refresh the router to trigger server-side re-renders with the new cookie
    router.refresh();
  };

  if (schools.length === 0) return null;

  if (schools.length === 1) {
    return (
      <div className="w-full text-left text-lg font-bold text-slate-900 py-1">
        <span className="whitespace-normal pr-2">
          {schools[0].schoolName || 'Unassigned School'}
        </span>
      </div>
    );
  }

  // Find the currently selected school to display on the trigger
  const currentSchool = schools.find(s => s.schoolId === selectedSchool) || schools[0];

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between text-left text-lg font-bold text-slate-900 bg-transparent border-transparent py-1 cursor-pointer outline-none transition-colors group"
      >
        <span className="whitespace-normal pr-2">
          {currentSchool.schoolName || 'Unassigned School'}
        </span>
        <svg 
          className={`w-5 h-5 text-slate-500 transition-transform duration-200 shrink-0 group-hover:text-slate-800 ${isOpen ? 'rotate-180' : ''}`} 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <ul className="absolute left-0 mt-2 w-72 max-w-sm bg-white border border-slate-200 shadow-sm rounded-md overflow-hidden z-50">
          {schools.map((s) => {
            const isSelected = s.schoolId === selectedSchool;
            return (
              <li key={s.schoolId}>
                <button
                  onClick={() => handleSelect(s.schoolId)}
                  className={`w-full text-left whitespace-normal px-4 py-3 text-sm transition-colors ${
                    isSelected 
                      ? 'bg-blue-50 text-blue-900 font-semibold' 
                      : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900 font-medium'
                  }`}
                >
                  {s.schoolName || 'Unassigned School'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
