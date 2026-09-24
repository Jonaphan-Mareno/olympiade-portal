'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';

export type PortalMembership = {
  portalId: string;
  portalName: string | null;
  schoolName: string | null;
};

export default function PortalSwitcher({ portals, activePortalId }: { portals: PortalMembership[], activePortalId: string }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (newPortalId: string) => {
    setIsOpen(false);
    router.push(`/results/${newPortalId}`);
  };

  if (portals.length === 0) return null;

  const currentPortal = portals.find(p => p.portalId === activePortalId) || portals[0];

  return (
    <div className="relative" ref={dropdownRef}>
      {currentPortal.schoolName && (
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
          {currentPortal.schoolName}
        </p>
      )}
      
      {portals.length === 1 ? (
        <div className="w-full text-left text-lg font-bold text-slate-900 py-1">
          <span className="whitespace-normal pr-2">
            {currentPortal.portalName || 'Unassigned Olympiad'}
          </span>
        </div>
      ) : (
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center justify-between text-left text-lg font-bold text-slate-900 bg-transparent border-transparent py-1 cursor-pointer outline-none transition-colors group"
        >
          <span className="whitespace-normal pr-2">
            {currentPortal.portalName || 'Unassigned Olympiad'}
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
      )}

      {isOpen && portals.length > 1 && (
        <ul className="absolute left-0 mt-2 w-72 max-w-sm bg-white border border-slate-200 shadow-sm rounded-md overflow-hidden z-50">
          {portals.map((p) => {
            const isSelected = p.portalId === activePortalId;
            return (
              <li key={p.portalId}>
                <button
                  onClick={() => handleSelect(p.portalId)}
                  className={`w-full text-left flex flex-col px-4 py-3 text-sm transition-colors ${
                    isSelected 
                      ? 'bg-blue-50 text-blue-900' 
                      : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <span className={`font-semibold ${isSelected ? 'text-blue-900' : 'text-slate-900'}`}>
                    {p.portalName || 'Unassigned Olympiad'}
                  </span>
                  {p.schoolName && (
                    <span className="text-xs text-slate-500 mt-0.5">
                      {p.schoolName}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
