import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { memberships, users, portals, rounds, schools } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import HeroBanner from '@/components/ui/HeroBanner';
import Link from 'next/link';
import { deriveRoundState } from '@/domain/rounds/round-state-machine';

export default async function StudentRoundsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Fetch the student's global school_id from their user profile
  const [currentUser] = await db.select({ schoolId: users.schoolId }).from(users).where(eq(users.id, user.id));
  const globalSchoolId = currentUser?.schoolId;

  const studentMemberships = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, user.id),
        eq(memberships.role, 'student'),
        globalSchoolId ? eq(memberships.schoolId, globalSchoolId) : undefined
      )
    );

  if (studentMemberships.length === 0) {
    return (
      <div className="min-h-screen bg-[#F8FAFC]">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <p className="text-slate-600">You are not enrolled in any Olympiads yet.</p>
        </div>
      </div>
    );
  }

  const portalIds = [...new Set(studentMemberships.map((m) => m.portalId))];
  const allRounds = portalIds.length > 0 
    ? await db.select().from(rounds).where(inArray(rounds.portalId, portalIds)).orderBy(rounds.orderIndex)
    : [];

  const now = new Date();

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <div className="bg-blue-950 p-8 text-white mb-8">
        <h1 className="text-3xl font-bold font-serif mb-2">My Rounds</h1>
        <p className="text-blue-200">View all your upcoming and past rounds.</p>
      </div>
      
      <div className="max-w-6xl mx-auto px-4 md:px-8 pb-12">
        <div className="flex flex-col gap-4">
          {allRounds.map((r) => {
            const state = deriveRoundState(r, now);
            
            return (
              <div key={r.id} className="bg-white border-2 border-slate-200 p-6 rounded-none flex flex-col md:flex-row justify-between items-center gap-4">
                <div>
                  <h3 className="text-xl font-bold text-blue-950 mb-1">{r.name}</h3>
                  <p className="text-slate-600 text-sm">
                    {state === 'open' ? 'Currently open until ' : 'Opens '}
                    {new Date(state === 'open' ? r.closesAt : r.opensAt).toLocaleDateString()}
                  </p>
                </div>
                <div>
                  {state === 'open' ? (
                    <span className="bg-amber-400 text-amber-950 px-4 py-1.5 font-bold text-xs uppercase tracking-wider rounded-none">
                      Active
                    </span>
                  ) : (
                    <span className="bg-slate-100 text-slate-600 px-4 py-1.5 font-bold text-xs uppercase tracking-wider rounded-none border border-slate-200">
                      {state === 'scheduled' ? 'Upcoming' : 'Closed'}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
