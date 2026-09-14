import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { schools } from '@/lib/db/schema';
import { and, eq, ilike } from 'drizzle-orm';
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

  const portalId = request.nextUrl.searchParams.get('portalId')?.trim() ?? '';
  const q = request.nextUrl.searchParams.get('q')?.trim() ?? '';

  // Schools are per-olympiad rows: never suggest another portal's school,
  // otherwise its memberships leak participants across portals.
  if (!portalId) {
    return NextResponse.json(
      { error: 'portalId is required' },
      { status: 400 }
    );
  }

  if (q.length < 2) {
    return NextResponse.json([]);
  }

  const results = await db
    .select({
      id: schools.id,
      name: schools.name,
    })
    .from(schools)
    .where(and(eq(schools.portalId, portalId), ilike(schools.name, `%${q}%`)))
    .limit(10);

  return NextResponse.json(results);
}
