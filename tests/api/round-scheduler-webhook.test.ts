import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from '@/app/api/webhooks/round-scheduler/route';

const state = vi.hoisted(() => ({
  sweepResult: null as any,
  sweepError: null as Error | null,
}));

vi.mock('@/domain/rounds/round-scheduler', () => ({
  sweep: vi.fn(async () => {
    if (state.sweepError) throw state.sweepError;
    return state.sweepResult;
  }),
}));

const sweepResult = {
  ranAt: '2026-09-14T07:00:00.000Z',
  portalCount: 1,
  roundCount: 2,
  outcomes: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  state.sweepResult = sweepResult;
  state.sweepError = null;
  delete process.env.CRON_SECRET;
});

describe('/api/webhooks/round-scheduler', () => {
  it('runs the sweep and returns its result on GET', async () => {
    const res = await GET(
      new Request('http://localhost:3000/api/webhooks/round-scheduler')
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual(sweepResult);
  });

  it('accepts POST for manual/external triggers', async () => {
    const res = await POST(
      new Request('http://localhost:3000/api/webhooks/round-scheduler', {
        method: 'POST',
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual(sweepResult);
  });

  it('rejects requests with the wrong secret', async () => {
    process.env.CRON_SECRET = 's3cret';

    const res = await GET(
      new Request('http://localhost:3000/api/webhooks/round-scheduler')
    );

    expect(res.status).toBe(401);
  });

  it('accepts the Bearer token from Vercel Cron', async () => {
    process.env.CRON_SECRET = 's3cret';

    const res = await GET(
      new Request('http://localhost:3000/api/webhooks/round-scheduler', {
        headers: { authorization: 'Bearer s3cret' },
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual(sweepResult);
  });

  it('accepts the secret as a query parameter (cron + curl style)', async () => {
    process.env.CRON_SECRET = 's3cret';

    const res = await GET(
      new Request(
        'http://localhost:3000/api/webhooks/round-scheduler?secret=s3cret'
      )
    );

    expect(res.status).toBe(200);
  });

  it('returns 500 with diagnostics when the sweep fails', async () => {
    state.sweepError = new Error('database unreachable');

    const res = await GET(
      new Request('http://localhost:3000/api/webhooks/round-scheduler')
    );
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('Sweep failed');
    expect(json.message).toBe('database unreachable');
  });
});
