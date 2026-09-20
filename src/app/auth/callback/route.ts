import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Supabase email links (password recovery today, email confirmations later)
// land here with a one-time `code`. Exchange it for a session server-side,
// then continue to the page the flow asked for.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const { searchParams } = url;
  const code = searchParams.get('code');

  // Only allow relative redirect targets (and never protocol-relative "//"
  // URLs) so the ?next= parameter can't be turned into an open redirect.
  const nextParam = searchParams.get('next') ?? '/reset-password';
  const next =
    nextParam.startsWith('/') && !nextParam.startsWith('//')
      ? nextParam
      : '/reset-password';

  // Proxies (e.g. Vercel) report the public host via x-forwarded-host — the
  // request URL itself can name a different deployment. Next.js also injects
  // that header for plain local requests, where it must NOT be upgraded to
  // https: take the scheme from x-forwarded-proto when a proxy sets it, and
  // otherwise keep the scheme the request actually arrived on.
  const forwardedHost = request.headers
    .get('x-forwarded-host')
    ?.split(',')[0]
    .trim();
  const forwardedProto = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    .trim();
  const base = forwardedHost
    ? `${forwardedProto || url.protocol.replace(':', '')}://${forwardedHost}`
    : url.origin;

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${base}${next}`);
    }

    console.error('Auth code exchange failed:', error.message);
  }

  // Missing, invalid, or already-used code — send them back to try again.
  return NextResponse.redirect(`${base}/forgot-password?resetLink=invalid`);
}
