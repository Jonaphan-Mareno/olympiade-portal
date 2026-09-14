import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { studentAnswers, examSittings } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const sittingId = searchParams.get('sittingId');

    if (!sittingId) {
      return NextResponse.json({ error: 'Missing sittingId' }, { status: 400 });
    }

    const [sitting] = await db
      .select()
      .from(examSittings)
      .where(eq(examSittings.id, sittingId));

    if (!sitting) {
      return NextResponse.json({ error: 'Sitting not found' }, { status: 404 });
    }

    const answers = await db
      .select()
      .from(studentAnswers)
      .where(eq(studentAnswers.sittingId, sittingId));

    return NextResponse.json({ sitting, answers });
  } catch (error: any) {
    console.error('Error syncing answers:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}
