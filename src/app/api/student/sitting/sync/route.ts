import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { studentAnswers, examSittings, memberships, questionPapers } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sittingId = new URL(request.url).searchParams.get('sittingId');
    if (!sittingId) return NextResponse.json({ error: 'Missing sittingId' }, { status: 400 });

    const [row] = await db.select({ sitting: examSittings, paper: questionPapers })
      .from(examSittings)
      .innerJoin(memberships, eq(memberships.id, examSittings.studentMembershipId))
      .innerJoin(questionPapers, eq(questionPapers.id, examSittings.questionPaperId))
      .where(and(eq(examSittings.id, sittingId), eq(memberships.userId, user.id)))
      .limit(1);
    if (!row) return NextResponse.json({ error: 'Sitting not found' }, { status: 404 });

    const answers = await db.select().from(studentAnswers).where(eq(studentAnswers.sittingId, sittingId));
    return NextResponse.json({ sitting: row.sitting, durationMinutes: row.paper.durationMinutes ?? 60, answers });
  } catch (error) {
    console.error('Error syncing answers:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
