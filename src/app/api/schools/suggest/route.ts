import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  loadHighSchools,
  searchHighSchools,
  searchUniversities,
  UniversitiesApiError,
} from '@/lib/schools';
import { isSchoolType } from '@/lib/schools/types';

// School suggestions for the picker. Schools are never free-typed:
// - type=high_school  -> searched in the local snapshot of the SA directory
//   (src/data/south-african-high-schools.json, no upstream calls at all)
// - type=university   -> proxied through the free hipolabs API server-side
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
  const type = request.nextUrl.searchParams.get('type')?.trim() ?? '';

  if (!isSchoolType(type)) {
    return NextResponse.json(
      { error: 'type must be "high_school" or "university"' },
      { status: 400 }
    );
  }

  if (q.length < 2) {
    return NextResponse.json([]);
  }

  if (type === 'high_school') {
    return NextResponse.json(searchHighSchools(loadHighSchools(), q));
  }

  try {
    return NextResponse.json(await searchUniversities(q));
  } catch (err) {
    if (err instanceof UniversitiesApiError) {
      console.error('Suggesting universities failed:', err.message);
      return NextResponse.json(
        { error: 'University search is temporarily unavailable. Try again.' },
        { status: 502 }
      );
    }
    throw err;
  }
}
