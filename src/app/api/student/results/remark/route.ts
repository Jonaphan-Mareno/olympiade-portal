import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { memberships, submissions, results, remarkRequests, rounds } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { resultId, reason } = await request.json();
    if (!resultId || typeof reason !== 'string' || reason.trim().length < 5) return NextResponse.json({ error: 'Please provide a reason for the remark request.' }, { status: 400 });

    const [row] = await db.select({ result: results, submission: submissions, membership: memberships, round: rounds })
      .from(results)
      .innerJoin(submissions, eq(submissions.id, results.submissionId))
      .innerJoin(rounds, eq(rounds.id, submissions.roundId))
      .innerJoin(memberships, and(eq(memberships.id, submissions.studentMembershipId!), eq(memberships.userId, user.id), eq(memberships.role, 'student')))
      .where(eq(results.id, resultId)).limit(1);
    if (!row) return NextResponse.json({ error: 'Result not found' }, { status: 404 });
    if (row.result.status !== 'moderated') return NextResponse.json({ error: 'A remark can only be requested after marking has been reviewed.' }, { status: 400 });

    const existing = await db.select().from(remarkRequests).where(eq(remarkRequests.resultId, resultId)).limit(1);
    if (existing.length && existing[0].status === 'pending') return NextResponse.json({ error: 'A remark request is already pending.' }, { status: 400 });
    if (existing.length) {
      await db.update(remarkRequests).set({ reason: reason.trim(), status: 'pending', requestedAt: new Date(), reviewedAt: null, reviewedByMembershipId: null }).where(eq(remarkRequests.id, existing[0].id));
    } else {
      await db.insert(remarkRequests).values({ resultId, reason: reason.trim(), status: 'pending' });
    }
    await db.update(results).set({ status: 'remark_requested' }).where(eq(results.id, resultId));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error requesting remark:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
