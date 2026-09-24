import { NextResponse } from 'next/server';

// Shared helpers for the public API routes (src/app/api/public/*). Every
// route in this tree is read-only and intentionally open - no auth check -
// and the wildcard CORS header lets the public website (or any other client)
// read these endpoints straight from the browser.

const PUBLIC_CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' } as const;

export function publicJson(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: PUBLIC_CORS_HEADERS });
}
