'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import SignOutButton from '@/app/organiser/SignOutButton';

export default function StudentNavbar() {
  const pathname = usePathname();
  const [isTestDarkMode, setIsTestDarkMode] = useState(false);

  const isSitting = pathname?.includes('/sitting/');

  useEffect(() => {
    if (isSitting) {
      const storedTheme = localStorage.getItem('test_theme');
      if (storedTheme === 'dark') setIsTestDarkMode(true);
      
      const interval = setInterval(() => {
         const current = localStorage.getItem('test_theme');
         setIsTestDarkMode(current === 'dark');
      }, 300);
      return () => clearInterval(interval);
    } else {
      setIsTestDarkMode(false);
    }
  }, [isSitting]);

  const darkTheme = isSitting && isTestDarkMode;

  return (
    <header
      className={`border-b px-8 py-4 flex justify-between items-center sticky top-0 z-50 transition-colors ${
        darkTheme 
          ? 'bg-slate-950 text-white border-slate-800' 
          : 'bg-white text-slate-900 border-slate-200'
      }`}
    >
      <Link
        href="/dashboard"
        className="flex items-center gap-2 no-underline"
      >
        <Image
          src="/images/logo-BIG-v2.jpg"
          alt="Olympia Logo"
          width={32}
          height={32}
          className="object-contain"
        />
        <span
          className={`font-bold text-xl ${
            darkTheme ? 'text-blue-400' : 'text-blue-600'
          }`}
        >
          Olympia
        </span>
      </Link>

      <div className={darkTheme ? 'dark' : ''}>
        <SignOutButton />
      </div>
    </header>
  );
}
