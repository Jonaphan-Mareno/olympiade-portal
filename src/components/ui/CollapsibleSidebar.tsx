'use client';
import { useState, ReactNode, useEffect } from 'react';

export default function CollapsibleSidebar({ sidebarContent, children }: { sidebarContent: ReactNode, children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (window.innerWidth < 768) {
      setIsOpen(false);
    }
  }, []);

  if (!mounted) {
    return (
      <div className="min-h-screen flex bg-slate-50 font-sans relative overflow-x-hidden">
        <aside className="bg-white border-r border-slate-200 flex flex-col fixed inset-y-0 z-40 w-64 translate-x-0 h-full">
          {sidebarContent}
        </aside>
        <main className="flex-1 min-h-screen relative ml-64 flex flex-col">
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-slate-50 font-sans relative overflow-x-hidden">
      {/* Sidebar */}
      <aside 
        className={`bg-white border-r border-slate-200 flex flex-col fixed inset-y-0 z-40 transition-transform duration-300 ease-in-out h-full ${
          isOpen ? 'w-64 translate-x-0' : 'w-64 -translate-x-full'
        }`}
      >
        {sidebarContent}
      </aside>

      {/* Main Content Area */}
      <main 
        className={`flex-1 min-h-screen transition-all duration-300 ease-in-out relative flex flex-col ${
          isOpen ? 'ml-64' : 'ml-0'
        }`}
      >
        {/* Toggle Button */}
        <button 
          onClick={() => setIsOpen(!isOpen)}
          className={`fixed top-1/2 -translate-y-1/2 z-50 bg-white border border-slate-200 text-slate-500 hover:text-blue-600 rounded-r-md p-2 shadow-sm transition-all duration-300 flex items-center justify-center cursor-pointer ${
            isOpen ? 'left-64 border-l-0' : 'left-0'
          }`}
          title={isOpen ? "Collapse Sidebar" : "Expand Sidebar"}
        >
          {isOpen ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
          )}
        </button>
        
        {children}
      </main>
    </div>
  );
}
