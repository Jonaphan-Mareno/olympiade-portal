import { ReactNode } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import SignOutButton from '@/app/organiser/SignOutButton';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { memberships, portals, schools } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import SidebarNav from '@/components/educator/SidebarNav';
import SchoolSwitcher, { SchoolMembership } from '@/components/educator/SchoolSwitcher';

export default async function EducatorLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Get all educator memberships to feed the portal switcher
  const educatorMemberships = await db
    .select({
      portalId: memberships.portalId,
      schoolId: memberships.schoolId,
      portalName: portals.name,
      schoolName: schools.name,
    })
    .from(memberships)
    .leftJoin(portals, eq(memberships.portalId, portals.id))
    .leftJoin(schools, eq(memberships.schoolId, schools.id))
    .where(
      and(eq(memberships.userId, user.id), eq(memberships.role, 'educator'))
    );

  if (educatorMemberships.length === 0) {
    redirect('/dashboard');
  }

  // Extract unique schools
  const uniqueSchoolsMap = new Map<string, SchoolMembership>();
  for (const m of educatorMemberships) {
    if (m.schoolId && !uniqueSchoolsMap.has(m.schoolId)) {
      uniqueSchoolsMap.set(m.schoolId, {
        schoolId: m.schoolId,
        schoolName: m.schoolName,
      });
    }
  }
  const uniqueSchools = Array.from(uniqueSchoolsMap.values());

  const cookieStore = await cookies();
  const activeSchoolId = cookieStore.get('active_school_id')?.value;

  return (
    <div className="min-h-screen flex bg-slate-50 font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col fixed inset-y-0 z-50">
        <div className="p-6 border-b border-slate-200">
          <Link href="/educator" className="flex items-center gap-2 no-underline mb-6">
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
          <SchoolSwitcher schools={uniqueSchools} activeSchoolId={activeSchoolId} />
        </div>

        <SidebarNav />

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
