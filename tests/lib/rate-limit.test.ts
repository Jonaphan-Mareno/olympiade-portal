import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';

// The helper is exercised against a mocked Upstash client: no network, and
// each test re-imports the module so its lazily-created Redis client picks up
// the env vars that test sets.

const h = vi.hoisted(() => ({
  limit: vi.fn(),
  ctorArgs: [] as any[],
  headers: new Map<string, string>(),
}));

vi.mock('@upstash/redis', () => ({
  Redis: class {
    constructor(public opts: unknown) {}
  },
}));

vi.mock('@upstash/ratelimit', () => {
  class Ratelimit {
    static slidingWindow = (tokens: number, window: string) => ({ tokens, window });
    constructor(args: unknown) {
      h.ctorArgs.push(args);
    }
    limit = h.limit;
  }
  return { Ratelimit };
});

vi.mock('next/headers', () => ({
  headers: async () => ({ get: (k: string) => h.headers.get(k) ?? null }),
}));

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

async function load(configured: boolean) {
  vi.resetModules();
  if (configured) {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token';
  }
  return import('@/lib/rate-limit');
}

beforeEach(() => {
  h.limit.mockReset();
  h.ctorArgs = [];
  h.headers = new Map();
});

afterEach(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

describe('rate-limit helper', () => {
  it('allows everything without touching Redis when Upstash is not configured', async () => {
    const rl = await load(false);
    expect(rl.isRateLimitingEnabled()).toBe(false);
    expect(await rl.checkRateLimit('publicApi', '1.2.3.4')).toEqual({ success: true, retryAfterSeconds: 0 });
    expect(await rl.authRateLimitError('login', 'a@b.com')).toBeNull();
    expect(await rl.inviteRateLimitError('user-1', 5000)).toBeNull();
    expect(h.limit).not.toHaveBeenCalled();
  });

  it('hashes the identifier, passes the cost, and uses the configured window', async () => {
    const rl = await load(true);
    h.limit.mockResolvedValue({ success: true, reset: Date.now() });

    await rl.checkRateLimit('inviteEmails', ' User-1 ', 25);

    expect(h.limit).toHaveBeenCalledWith(sha('user-1'), { rate: 25 });
    expect(h.ctorArgs[0]).toMatchObject({
      prefix: 'olympiad-rl:inviteEmails',
      limiter: { tokens: 1000, window: '1 h' },
    });
  });

  it('reports a retry delay when limited', async () => {
    const rl = await load(true);
    h.limit.mockResolvedValue({ success: false, reset: Date.now() + 90_000 });

    const r = await rl.checkRateLimit('publicApi', 'ip');
    expect(r.success).toBe(false);
    expect(r.retryAfterSeconds).toBeGreaterThanOrEqual(89);
    expect(r.retryAfterSeconds).toBeLessThanOrEqual(90);
  });

  it('fails open when Redis errors', async () => {
    const rl = await load(true);
    h.limit.mockRejectedValue(new Error('network down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await rl.checkRateLimit('publicApi', 'ip')).toEqual({ success: true, retryAfterSeconds: 0 });
    spy.mockRestore();
  });

  it('limits auth by both IP and email, keyed from x-real-ip', async () => {
    const rl = await load(true);
    h.headers.set('x-real-ip', '9.9.9.9');
    h.limit
      .mockResolvedValueOnce({ success: true, reset: Date.now() })
      .mockResolvedValueOnce({ success: false, reset: Date.now() + 600_000 });

    const msg = await rl.authRateLimitError('login', 'Victim@School.edu');

    expect(h.limit).toHaveBeenNthCalledWith(1, sha('9.9.9.9'), { rate: 1 });
    expect(h.limit).toHaveBeenNthCalledWith(2, sha('victim@school.edu'), { rate: 1 });
    expect(msg).toBe('Too many attempts. Please wait 10 minutes and try again.');
  });

  it('takes the first x-forwarded-for hop when x-real-ip is absent', async () => {
    const rl = await load(true);
    h.headers.set('x-forwarded-for', '5.5.5.5, 10.0.0.1');
    expect(await rl.getClientIp()).toBe('5.5.5.5');
  });

  it('rejects a single invite batch larger than the hourly cap outright', async () => {
    const rl = await load(true);
    const msg = await rl.inviteRateLimitError('user-1', 1001);
    expect(msg).toMatch(/at most 1000 invitations per hour/);
    expect(h.limit).not.toHaveBeenCalled();
  });
});
