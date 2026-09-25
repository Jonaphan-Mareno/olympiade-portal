'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function SidebarNav() {
  const pathname = usePathname();

  const links = [
    { name: 'Overview', href: '/educator' },
    { name: 'Manage Olympiads', href: '/educator/entrants' },
    { name: 'Assessments', href: '/educator/rounds' },
    { name: 'Results & Standings', href: '/educator/results' },
    { name: 'Notifications', href: '/educator/notifications' },
  ];

  return (
    <nav className="flex-1 p-4 space-y-1">
      {links.map((link) => {
        const isActive = pathname === link.href;
        return (
          <Link
            key={link.name}
            href={link.href}
            prefetch={true}
            className={`block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              isActive
                ? 'bg-blue-50 text-blue-900'
                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            {link.name}
          </Link>
        );
      })}
    </nav>
  );
}
