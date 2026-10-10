import { describe, it, expect, vi, beforeEach } from 'vitest';

// GET /api/scripts/[pageId]: auth, the domain's access decision, and that the
// bytes are streamed privately (never a public URL, never cached).
const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
  page: null as { storagePath: string; contentType: string } | null,
  blob: null as Blob | null,
  calls: [] as [string, string][],
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user }, error: null }) },
  }),
}));
vi.mock('@/domain/scripts/script-pages', () => ({
  getViewableScriptPage: vi.fn(async (userId: string, pageId: string) => {
    h.calls.push([userId, pageId]);
    return h.page;
  }),
}));
vi.mock('@/lib/storage/marked-scripts', () => ({
  downloadScriptObject: vi.fn(async () => h.blob),
}));

import { GET } from '@/app/api/scripts/[pageId]/route';

const PAGE_ID = '44444444-4444-4444-8444-444444444444';
const call = () =>
  GET(new Request(`http://localhost/api/scripts/${PAGE_ID}`), {
    params: Promise.resolve({ pageId: PAGE_ID }),
  });

beforeEach(() => {
  h.user = null;
  h.page = null;
  h.blob = null;
  h.calls = [];
});

describe('GET /api/scripts/[pageId]', () => {
  it('requires a signed-in user', async () => {
    const res = await call();
    expect(res.status).toBe(401);
    expect(h.calls).toEqual([]);
  });

  it('returns 404 when the page is missing or the user may not see it', async () => {
    h.user = { id: 'someone' };
    const res = await call();
    expect(res.status).toBe(404);
    expect(h.calls).toEqual([['someone', PAGE_ID]]);
  });

  it('streams the page privately with no caching', async () => {
    h.user = { id: 'entrant' };
    h.page = { storagePath: 'r/s/original/p.jpg', contentType: 'image/jpeg' };
    h.blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1])]);

    const res = await call();

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 1]));
  });

  it('returns 404 when the stored object is gone', async () => {
    h.user = { id: 'entrant' };
    h.page = { storagePath: 'r/s/original/p.jpg', contentType: 'image/jpeg' };
    const res = await call();
    expect(res.status).toBe(404);
  });
});
