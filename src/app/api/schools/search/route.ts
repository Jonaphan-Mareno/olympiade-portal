import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { schools } from '@/lib/db/schema';
import { ilike } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  // Auth check - /api routes bypass middleware
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get('q')?.trim() ?? '';

  if (q.length < 2) {
    return NextResponse.json([]);
  }

  const results = await db
    .select({
      id: schools.id,
      name: schools.name,
    })
    .from(schools)
    .where(ilike(schools.name, `%${q}%`))
    .limit(10);

  return NextResponse.json(results);
}
