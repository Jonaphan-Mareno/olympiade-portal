import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import HeroBanner from '@/components/ui/HeroBanner';
import { db } from '@/lib/db';
import { memberships, rounds } from '@/lib/db/schema';
import { eq, and, inArray, count } from 'drizzle-orm';
import { deriveRoundState } from '@/domain/rounds/round-state-machine';

export const dynamic = 'force-dynamic';

export default async function EducatorOverviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Get educator membership
  const educatorMemberships = await db
    .select()
    .from(memberships)
    .where(
      and(eq(memberships.userId, user.id), eq(memberships.role, 'educator'))
    );

  if (educatorMemberships.length === 0) {
    redirect('/dashboard'); // fallback
  }

  const cookieStore = await cookies();
  const activeSchoolId = cookieStore.get('active_school_id')?.value;

  const activeSchoolMemberships = activeSchoolId 
    ? educatorMemberships.filter((m) => m.schoolId === activeSchoolId)
    : educatorMemberships.filter(m => m.schoolId === educatorMemberships[0].schoolId);

  if (activeSchoolMemberships.length === 0 || !activeSchoolMemberships[0].schoolId) {
    return <div>No school assigned.</div>;
  }

  const schoolId = activeSchoolMemberships[0].schoolId;
  const portalIds = activeSchoolMemberships.map(m => m.portalId);

  // Fetch Total Entrants for this school across all its olympiads
  const totalEntrantsResult = portalIds.length > 0 
    ? await db
        .select({ totalEntrants: count() })
        .from(memberships)
        .where(
          and(
            eq(memberships.schoolId, schoolId),
            inArray(memberships.portalId, portalIds),
            eq(memberships.role, 'student')
          )
        )
    : [{ totalEntrants: 0 }];
    
  const totalEntrants = totalEntrantsResult[0].totalEntrants;

  // Fetch Rounds across all portals for this school
  const allRounds = portalIds.length > 0
    ? await db
        .select()
        .from(rounds)
        .where(inArray(rounds.portalId, portalIds))
    : [];

  const now = new Date();
  
  let activeRoundsCount = 0;
  let nextRoundDate: Date | null = null;
  let nextRoundDiff = '';

  for (const round of allRounds) {
    const state = deriveRoundState(round, now);
    if (state === 'open') {
      activeRoundsCount++;
    }
  }

  // Find next round countdown (closest closesAt that is in future)
  // or opensAt if no rounds are open.
  const upcomingRounds = allRounds
    .filter(r => r.closesAt > now)
    .sort((a, b) => {
      // Prioritize currently open rounds (closesAt) vs upcoming rounds (opensAt)
      const dateA = a.opensAt > now ? a.opensAt : a.closesAt;
      const dateB = b.opensAt > now ? b.opensAt : b.closesAt;
      return dateA.getTime() - dateB.getTime();
    });

  if (upcomingRounds.length > 0) {
    const nextRound = upcomingRounds[0];
    nextRoundDate = nextRound.opensAt > now ? nextRound.opensAt : nextRound.closesAt;
    const diffMs = nextRoundDate.getTime() - now.getTime();
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    nextRoundDiff = `${days}d ${hours}h`;
  } else {
    nextRoundDiff = 'None';
  }

  const displayName = user.user_metadata?.full_name || user.email;
  const firstName = displayName?.split(' ')[0] || 'Educator';
  const initial = (user.user_metadata?.full_name?.charAt(0) || user.email?.charAt(0) || '?').toUpperCase();

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <HeroBanner
        userName={firstName}
        userInitial={initial}
        subtitle="Here is what's happening with your school today."
      />
      
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-8">
        


        <div className="flex justify-between items-center w-full mb-6">
          <h2 className="font-serif text-3xl md:text-4xl text-blue-950 font-bold m-0">
            Overview
          </h2>
        </div>

        {/* Summary Dashboard Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          
          {/* Card 1 */}
          <div
            className="hover:border-blue-300 transition-all duration-200 bg-white"
            style={{
              padding: '1.5rem',
              border: '1px solid #E2E8F0',
              borderRadius: '0.5rem',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
            }}
          >
            <span className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-1">Total Entrants</span>
            <span className="text-3xl font-bold text-slate-900">{totalEntrants}</span>
          </div>

          {/* Card 2 */}
          <div
            className="hover:border-blue-300 transition-all duration-200 bg-white"
            style={{
              padding: '1.5rem',
              border: '1px solid #E2E8F0',
              borderRadius: '0.5rem',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
            }}
          >
            <span className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-1">Rounds Currently Open</span>
            <span className="text-3xl font-bold text-slate-900">{activeRoundsCount}</span>
          </div>

          {/* Card 3 */}
          <div
            className="hover:border-blue-300 transition-all duration-200 bg-white"
            style={{
              padding: '1.5rem',
              border: '1px solid #E2E8F0',
              borderRadius: '0.5rem',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
            }}
          >
            <span className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-1">Next Round In</span>
            <span className="text-3xl font-bold text-slate-900">{nextRoundDiff}</span>
          </div>

          {/* Card 4 */}
          <div
            className="hover:border-blue-300 transition-all duration-200 bg-white"
            style={{
              padding: '1.5rem',
              border: '1px solid #E2E8F0',
              borderRadius: '0.5rem',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
            }}
          >
            <span className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-1">Pending Remarks</span>
            <span className="text-3xl font-bold text-slate-900">0</span>
          </div>

        </div>

      </div>
    </div>
  );
}
