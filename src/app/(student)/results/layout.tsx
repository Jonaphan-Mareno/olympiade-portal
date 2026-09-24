import { ReactNode } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import SignOutButton from '@/app/organiser/SignOutButton';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import StudentSidebarNav from '@/components/student/StudentSidebarNav';
import { headers } from 'next/headers';

export default async function StudentGlobalLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Check if we are in a sitting route
  const headersList = await headers();
  const pathname = headersList.get('x-invoke-path') || '';
  const isSitting = pathname.includes('/sitting/');

  if (isSitting) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen flex bg-slate-50 font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col fixed inset-y-0 z-50">
        <div className="p-6 border-b border-slate-200">
          <Link href="/dashboard" className="flex items-center gap-2 no-underline">
            <Image
              src="/images/logo-BIG-v2.jpg"
              alt="Olympia Logo"
              width={28}
              height={28}
              className="object-contain"
            />
            <span className="text-blue-600 font-bold text-xl">
              Olympia
            </span>
          </Link>
          <div className="mt-4">
             <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
               Student Portal
             </p>
          </div>
        </div>

        <StudentSidebarNav />

        <div className="p-4 border-t border-slate-200">
          <SignOutButton />
        </div>
      </aside>

      {/* Main Content Area - Offset by sidebar width */}
      <main className="flex-1 ml-64 min-h-screen">
        {children}
      </main>
    </div>
  );
}
