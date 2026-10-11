import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { Ratelimit, type Duration } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// Shared rate limiting backed by Upstash Redis. Vercel runs many stateless
// function instances, so counters must live in a shared store — an in-memory
// Map would only limit per instance.
//
// Fails OPEN: with no UPSTASH_REDIS_REST_URL/TOKEN configured (local dev,
// tests) every check passes, and a Redis outage or slow response (> timeout)
// also lets the request through rather than taking the app down with it.

export const RATE_LIMITS = {
  publicApi: { limit: 120, window: '1 m' },
  loginIp: { limit: 300, window: '15 m' },
  loginEmail: { limit: 10, window: '15 m' },
  signupIp: { limit: 100, window: '1 h' },
  signupEmail: { limit: 5, window: '1 h' },
  resetRequestIp: { limit: 20, window: '1 h' },
  resetRequestEmail: { limit: 3, window: '1 h' },
  resetPasswordIp: { limit: 20, window: '1 h' },
  universitySuggest: { limit: 30, window: '1 m' },
  inviteEmails: { limit: 1000, window: '1 h' },
} as const satisfies Record<string, { limit: number; window: Duration }>;

export type RateLimitName = keyof typeof RATE_LIMITS;

export type RateLimitResult = { success: boolean; retryAfterSeconds: number };

const ALLOWED: RateLimitResult = { success: true, retryAfterSeconds: 0 };

let redis: Redis | null | undefined;
const limiters = new Map<RateLimitName, Ratelimit>();

function getRedis(): Redis | null {
  if (redis === undefined) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (url && token) {
      redis = new Redis({ url, token });
    } else {
      redis = null;
      if (process.env.NODE_ENV === 'production') {
        console.warn(
          'Rate limiting is DISABLED: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set.'
        );
      }
    }
  }
  return redis;
}

export function isRateLimitingEnabled(): boolean {
  return getRedis() !== null;
}

function getLimiter(name: RateLimitName): Ratelimit | null {
  const client = getRedis();
  if (!client) return null;
  let limiter = limiters.get(name);
  if (!limiter) {
    const { limit, window } = RATE_LIMITS[name];
    limiter = new Ratelimit({
      redis: client,
      limiter: Ratelimit.slidingWindow(limit, window),
      prefix: `olympiad-rl:${name}`,
      timeout: 1500,
    });
    limiters.set(name, limiter);
  }
  return limiter;
}

// Identifiers (emails, IPs, user ids) are hashed so no raw personal data is
// stored in the external Redis.
function hashIdentifier(identifier: string): string {
  return createHash('sha256').update(identifier.trim().toLowerCase()).digest('hex');
}

/** Consumes `cost` tokens from the named limit for `identifier`. */
export async function checkRateLimit(
  name: RateLimitName,
  identifier: string,
  cost = 1
): Promise<RateLimitResult> {
  const limiter = getLimiter(name);
  if (!limiter) return ALLOWED;
  try {
    const result = await limiter.limit(hashIdentifier(identifier), { rate: cost });
    if (result.success) return ALLOWED;
    return {
      success: false,
      retryAfterSeconds: Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)),
    };
  } catch (err) {
    console.error(`Rate limit check "${name}" failed; allowing request:`, err);
    return ALLOWED;
  }
}

/** Runs several checks; fails if any fails, reporting the longest wait. */
export async function checkRateLimits(
  checks: Array<[RateLimitName, string]>
): Promise<RateLimitResult> {
  const results = await Promise.all(
    checks.map(([name, identifier]) => checkRateLimit(name, identifier))
  );
  const failed = results.filter((r) => !r.success);
  if (failed.length === 0) return ALLOWED;
  return {
    success: false,
    retryAfterSeconds: Math.max(...failed.map((r) => r.retryAfterSeconds)),
  };
}

/**
 * The caller's IP. On Vercel, x-real-ip / x-forwarded-for are set by the
 * platform edge, not the client. Behind another proxy this would need review.
 */
export async function getClientIp(): Promise<string> {
  try {
    const h = await headers();
    return (
      h.get('x-real-ip')?.trim() ||
      h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      'unknown'
    );
  } catch {
    return 'unknown';
  }
}

export function formatRetryAfter(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/** Shared IP + email check for the auth Server Actions; returns an error message or null. */
export async function authRateLimitError(
  kind: 'login' | 'signup' | 'resetRequest',
  email: string
): Promise<string | null> {
  if (!isRateLimitingEnabled()) return null;
  const ip = await getClientIp();
  const result = await checkRateLimits([
    [`${kind}Ip`, ip],
    [`${kind}Email`, email],
  ]);
  if (result.success) return null;
  return `Too many attempts. Please wait ${formatRetryAfter(result.retryAfterSeconds)} and try again.`;
}

/**
 * Per-user cap on invitation emails, weighted by recipient count so one large
 * CSV batch counts the same as many small ones. Returns an error message or null.
 */
export async function inviteRateLimitError(
  userId: string,
  recipientCount: number
): Promise<string | null> {
  if (recipientCount === 0) return null;
  const { limit } = RATE_LIMITS.inviteEmails;
  if (recipientCount > limit && isRateLimitingEnabled()) {
    return `You can send at most ${limit} invitations per hour. Please split this list into smaller batches.`;
  }
  const result = await checkRateLimit('inviteEmails', userId, recipientCount);
  if (result.success) return null;
  return `You've sent a lot of invitations recently. Please wait ${formatRetryAfter(result.retryAfterSeconds)} and try again.`;
}
