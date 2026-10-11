import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp, isRateLimitingEnabled } from '@/lib/rate-limit';

// Shared helpers for the public API routes (src/app/api/public/*). Every
// route in this tree is read-only and intentionally open - no auth check -
// and the wildcard CORS header lets the public website (or any other client)
// read these endpoints straight from the browser.

const PUBLIC_CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' } as const;

export function publicJson(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: PUBLIC_CORS_HEADERS });
}

/**
 * Per-IP limit for the open public API. Call FIRST in every handler so a
 * limited request never reaches the database. Returns the 429 response to
 * send, or null when the request may proceed.
 */
export async function publicRateLimitResponse(): Promise<NextResponse | null> {
  if (!isRateLimitingEnabled()) return null;
  const result = await checkRateLimit('publicApi', await getClientIp());
  if (result.success) return null;
  return NextResponse.json(
    {
      error: 'Too many requests. Please slow down and try again shortly.',
      retryAfterSeconds: result.retryAfterSeconds,
    },
    {
      status: 429,
      headers: { ...PUBLIC_CORS_HEADERS, 'Retry-After': String(result.retryAfterSeconds) },
    }
  );
}
