import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { examSittings, memberships, questionPapers, questions, rounds } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { drawVariant } from '@/domain/question-bank/variant-generator';

/**
 * Fairness safety net: how many extra times to re-draw the variant with a fresh
 * crypto seed when a deal falls short of the target total. `drawVariant`
 * already guarantees exactness whenever the target is reachable, so this only
 * guards against a genuinely-unreachable pool (where every re-draw also falls
 * short and the structured warning is logged).
 */
const MAX_VARIANT_REDRAWS = 5;

/**
 * A stable, opaque seed for the option shuffle. `crypto.randomUUID` is present
 * in the Node server runtime; the fallback keeps the route safe in any
 * environment that lacks it. The value only has to be stable for the sitting's
 * lifetime (it is persisted on the row), not secret.
 */
function generateVariantSeed(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { roundId } = await request.json();
    if (!roundId) return NextResponse.json({ error: 'Missing roundId' }, { status: 400 });

    // Everything below runs in one transaction so the paper find-or-create and
    // the sitting insert are atomic and race-free: concurrent starts collapse
    // onto a single active sitting via the unique partial index + ON CONFLICT.
    return await db.transaction(async (tx) => {
      const [round] = await tx.select().from(rounds).where(eq(rounds.id, roundId));
      if (!round) return NextResponse.json({ error: 'Round not found' }, { status: 404 });

      const [membership] = await tx.select().from(memberships).where(and(
        eq(memberships.userId, user.id),
        eq(memberships.role, 'student'),
        eq(memberships.portalId, round.portalId),
        eq(memberships.status, 'accepted')
      ));
      if (!membership) return NextResponse.json({ error: 'You are not enrolled in this olympiad' }, { status: 403 });

      // Only online/hybrid rounds are sat in the browser; paper-only rounds
      // keep their existing rejection.
      if (round.deliveryMethod !== 'online' && round.deliveryMethod !== 'hybrid') {
        return NextResponse.json({ error: 'This round is not an online test' }, { status: 400 });
      }

      const now = new Date();
      if (now < round.opensAt) return NextResponse.json({ error: 'This test has not opened yet' }, { status: 400 });
      if (now > round.closesAt) return NextResponse.json({ error: 'This test is closed' }, { status: 400 });

      // Find-or-create the round's paper: INSERT … ON CONFLICT DO NOTHING, then
      // re-select so a concurrent creator's row is picked up rather than
      // duplicating (the round_id unique index makes this safe).
      await tx.insert(questionPapers).values({ roundId, durationMinutes: 60 }).onConflictDoNothing();
      const [paper] = await tx.select().from(questionPapers).where(eq(questionPapers.roundId, roundId)).limit(1);
      if (!paper) return NextResponse.json({ error: 'Could not prepare the test paper' }, { status: 500 });

      // Resume-first: an already-active sitting is returned as-is, WITHOUT
      // drawing a new variant (the frozen variant lives on the existing row).
      const [existing] = await tx.select().from(examSittings).where(and(
        eq(examSittings.studentMembershipId, membership.id),
        eq(examSittings.questionPaperId, paper.id),
        eq(examSittings.status, 'active')
      )).limit(1);
      if (existing) return NextResponse.json({ sittingId: existing.id, resumed: true });

      // Deal the difficulty-balanced variant that fills the fixed target total.
      const pool = await tx
        .select({ id: questions.id, marks: questions.marks, difficulty: questions.difficulty })
        .from(questions)
        .where(eq(questions.roundId, roundId));
      const target = round.targetTotalMarks ?? pool.reduce((sum, q) => sum + (q.marks ?? 0), 0);

      // Deal the difficulty-balanced variant that fills the fixed target total.
      // `drawVariant` guarantees an exact hit whenever the target is reachable,
      // so a shortfall here means the pool genuinely cannot reach it. As a
      // belt-and-braces fairness net, re-draw with a fresh crypto seed a few
      // times before accepting — this can only help and never exceeds target.
      let variant = drawVariant(pool, target);
      for (let attempt = 0; attempt < MAX_VARIANT_REDRAWS && variant.shortfall > 0; attempt++) {
        variant = drawVariant(pool, target);
      }
      if (variant.shortfall > 0) {
        // The publish guard should make this unreachable; deal it anyway and
        // log a structured warning rather than failing the sit.
        console.error('[sitting/start] variant could not reach the target total', {
          roundId,
          target,
          totalMarks: variant.totalMarks,
          shortfall: variant.shortfall,
        });
      }

      const inserted = await tx.insert(examSittings).values({
        studentMembershipId: membership.id,
        questionPaperId: paper.id,
        startedAt: now,
        status: 'active',
        variantQuestionIds: variant.questionIds,
        variantSeed: generateVariantSeed(),
      }).onConflictDoNothing().returning({ id: examSittings.id });

      if (inserted.length > 0) {
        return NextResponse.json({ sittingId: inserted[0].id, resumed: false });
      }

      // No row returned ⇒ a concurrent request won the active-sitting race.
      // Re-select its sitting and resume onto the already-dealt variant.
      const [winner] = await tx.select().from(examSittings).where(and(
        eq(examSittings.studentMembershipId, membership.id),
        eq(examSittings.questionPaperId, paper.id),
        eq(examSittings.status, 'active')
      )).limit(1);
      if (winner) return NextResponse.json({ sittingId: winner.id, resumed: true });

      return NextResponse.json({ error: 'Could not start the test' }, { status: 500 });
    });
  } catch (error) {
    console.error('Error starting sitting:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
