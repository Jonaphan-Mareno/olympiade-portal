'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function StudentSidebarNav() {
  const pathname = usePathname();

  const links = [
    { name: 'Overview', href: `/results` },
    { name: 'My Rounds', href: `/results/rounds` },
    { name: 'My Results', href: `/results/scores` },
    { name: 'Past Papers', href: `/results/past-papers` },
    { name: 'Notifications', href: `/results/notifications` },
  ];

  return (
    <nav className="flex-1 p-4 space-y-1">
      {links.map((link) => {
        const isActive = pathname === link.href;
        return (
          <Link
            key={link.name}
            href={link.href}
            className={`block px-4 py-2.5 text-sm font-medium transition-colors rounded-none ${
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
