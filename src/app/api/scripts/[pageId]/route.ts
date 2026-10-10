import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getViewableScriptPage } from '@/domain/scripts/script-pages';
import { downloadScriptObject } from '@/lib/storage/marked-scripts';

// One page of a marked paper script: GET /api/scripts/[pageId].
//
// - Scripts live in a private bucket; this route is the only way to view one.
// - The entrant may see their own pages once results are published; their
//   school's accepted educators and the olympiad's organiser at any time
//   (domain/scripts/script-rules decideScriptAccess).
// - Missing and forbidden pages both return 404, so ids can't be probed.
// - The bytes are sent from here (no signed URL that could be passed around)
//   and never cached.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const { pageId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });

  const page = await getViewableScriptPage(user.id, pageId);
  if (!page) return new NextResponse('Not found', { status: 404 });

  const blob = await downloadScriptObject(page.storagePath);
  if (!blob) return new NextResponse('Not found', { status: 404 });

  const bytes = Buffer.from(await blob.arrayBuffer());
  return new NextResponse(bytes, {
    headers: {
      'Content-Type': page.contentType,
      'Content-Length': String(bytes.length),
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
