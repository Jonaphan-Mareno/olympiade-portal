import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { examSittings, memberships } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { sittingId } = await request.json();
    if (!sittingId) return NextResponse.json({ error: 'Missing sittingId' }, { status: 400 });

    const [sitting] = await db.select({ sitting: examSittings })
      .from(examSittings)
      .innerJoin(memberships, eq(memberships.id, examSittings.studentMembershipId))
      .where(and(eq(examSittings.id, sittingId), eq(memberships.userId, user.id)))
      .limit(1);

    if (!sitting) return NextResponse.json({ error: 'Sitting not found' }, { status: 404 });
    if (sitting.sitting.status !== 'active') return NextResponse.json({ success: true });

    await db.update(examSittings).set({ status: 'submitted', endedAt: new Date() }).where(eq(examSittings.id, sittingId));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error submitting sitting:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
