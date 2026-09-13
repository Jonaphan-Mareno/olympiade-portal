import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { studentAnswers, examSittings } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { sittingId, questionNumber, answerValue } = body;

    if (!sittingId || typeof questionNumber !== 'number' || !answerValue) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Verify sitting
    const [sitting] = await db.select().from(examSittings).where(eq(examSittings.id, sittingId));
    
    if (!sitting) {
      return NextResponse.json({ error: 'Sitting not found' }, { status: 404 });
    }

    if (sitting.status !== 'active') {
      return NextResponse.json({ error: 'Exam sitting is not active' }, { status: 400 });
    }

    // Upsert answer
    await db.insert(studentAnswers)
      .values({
        sittingId,
        questionNumber,
        answerValue,
        savedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [studentAnswers.sittingId, studentAnswers.questionNumber],
        set: {
          answerValue,
          savedAt: new Date(),
        }
      });

    return NextResponse.json({ success: true, savedAt: new Date().toISOString() });
  } catch (error: any) {
    console.error('Error saving answer:', error);
    return NextResponse.json({ error: 'Internal server error', message: error.message }, { status: 500 });
  }
}
