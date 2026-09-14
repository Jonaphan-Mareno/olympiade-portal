import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { examSittings, memberships, questionPapers, rounds } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { roundId } = await request.json();
    if (!roundId) return NextResponse.json({ error: 'Missing roundId' }, { status: 400 });

    const [round] = await db.select().from(rounds).where(eq(rounds.id, roundId));
    if (!round) return NextResponse.json({ error: 'Round not found' }, { status: 404 });

    const [membership] = await db.select().from(memberships).where(and(
      eq(memberships.userId, user.id),
      eq(memberships.role, 'student'),
      eq(memberships.portalId, round.portalId),
      eq(memberships.status, 'accepted')
    ));
    if (!membership) return NextResponse.json({ error: 'You are not enrolled in this olympiad' }, { status: 403 });

    if (round.deliveryMethod !== 'online') {
      return NextResponse.json({ error: 'This round is not an online test' }, { status: 400 });
    }

    const now = new Date();
    if (now < round.opensAt) return NextResponse.json({ error: 'This test has not opened yet' }, { status: 400 });
    if (now > round.closesAt) return NextResponse.json({ error: 'This test is closed' }, { status: 400 });

    let [paper] = await db.select().from(questionPapers).where(eq(questionPapers.roundId, roundId)).limit(1);
    if (!paper) {
      [paper] = await db.insert(questionPapers).values({ roundId, durationMinutes: 60 }).returning();
    }

    const [existing] = await db.select().from(examSittings).where(and(
      eq(examSittings.studentMembershipId, membership.id),
      eq(examSittings.questionPaperId, paper.id),
      eq(examSittings.status, 'active')
    )).limit(1);

    if (existing) return NextResponse.json({ sittingId: existing.id, resumed: true });

    const [sitting] = await db.insert(examSittings).values({
      studentMembershipId: membership.id,
      questionPaperId: paper.id,
      startedAt: now,
      status: 'active',
    }).returning();

    return NextResponse.json({ sittingId: sitting.id, resumed: false });
  } catch (error) {
    console.error('Error starting sitting:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
