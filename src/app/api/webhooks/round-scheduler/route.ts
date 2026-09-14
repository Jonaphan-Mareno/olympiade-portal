import { NextResponse } from 'next/server';
import { sweep } from '@/domain/rounds/round-scheduler';

// Scheduled entry point for the reminder automation (see vercel.json crons).
// Vercel Cron calls GET with an `Authorization: Bearer <CRON_SECRET>` header;
// POST is also accepted so the sweep can be triggered manually or from other
// schedulers (GitHub Actions, cron + curl, ...). The sweep itself is
// idempotent, so overlapping or repeated invocations are harmless.

function extractSecret(request: Request): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length);
  }
  const url = new URL(request.url);
  return url.searchParams.get('secret');
}

async function handle(request: Request): Promise<NextResponse> {
  // When no CRON_SECRET is configured (e.g. local development) the endpoint
  // is open; in production always set CRON_SECRET.
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const provided = extractSecret(request);
    if (provided !== expected) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const result = await sweep();
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Round scheduler sweep failed:', error);
    return NextResponse.json(
      { error: 'Sweep failed', message: error?.message ?? String(error) },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
