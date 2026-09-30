import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from '@/app/api/certificates/[submissionId]/route';

// ─────────────────────────────────────────────────────────────────────────────
// Mock hub
// ─────────────────────────────────────────────────────────────────────────────
const h = vi.hoisted(() => {
  const state = {
    submissionRows: [] as any[],
    templateRows: [] as any[],
  };

  // The route runs two queries through db.select():
  //   • submissions → db.select({ roundId, studentName, invitedEmail, score })
  //   • templates   → db.select()   (no field list)
  // We tell them apart by whether a field list was supplied, then hand back a
  // chainable + thenable builder so both `.where()` and `.where().orderBy()`
  // can be awaited.
  const db = {
    select: (fields?: any) => {
      const isTemplateQuery = fields === undefined;
      const rows = () => (isTemplateQuery ? state.templateRows : state.submissionRows);
      const thenable = () => {
        const p: any = Promise.resolve(rows());
        p.orderBy = () => p;
        p.limit = () => p;
        return p;
      };
      const chain: any = {
        from: () => chain,
        innerJoin: () => chain,
        leftJoin: () => chain,
        where: () => thenable(),
        orderBy: () => thenable(),
        limit: () => thenable(),
      };
      return chain;
    },
  };

  // Minimal pdf-lib double.
  const page: any = {
    getSize: () => ({ width: 800, height: 600 }),
    drawImage: vi.fn(),
    drawText: vi.fn(),
  };
  const font: any = {
    widthOfTextAtSize: (t: string) => t.length * 10,
    heightAtSize: () => 40,
  };
  const image: any = { scale: () => ({ width: 800, height: 600 }) };
  const pdfDoc: any = {
    embedPng: vi.fn(async () => image),
    embedJpg: vi.fn(async () => image),
    embedFont: vi.fn(async () => font),
    addPage: vi.fn(() => page),
    getPages: vi.fn(() => [page]),
    save: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
  };
  const PDFDocument = {
    create: vi.fn(async () => pdfDoc),
    load: vi.fn(async () => pdfDoc),
  };

  return { state, db, page, pdfDoc, PDFDocument };
});

vi.mock('@/lib/db', () => ({ db: h.db }));
vi.mock('pdf-lib', () => ({
  PDFDocument: h.PDFDocument,
  rgb: (r: number, g: number, b: number) => ({ r, g, b }),
  StandardFonts: { HelveticaBold: 'Helvetica-Bold' },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function ctx(submissionId = 'sub-1') {
  return { params: Promise.resolve({ submissionId }) } as any;
}

function req(submissionId = 'sub-1') {
  return new Request(`http://localhost:3000/api/certificates/${submissionId}`);
}

function submission(over: any = {}) {
  return {
    roundId: 'r1',
    studentName: 'Ada Lovelace',
    invitedEmail: null,
    score: '80',
    ...over,
  };
}

function tier(over: any = {}) {
  return {
    minScorePercentage: '50',
    templateUrl: 'https://cdn.test/merit.png',
    nameXCoord: '50',
    nameYCoord: '50',
    nameFontSize: 48,
    nameTextColor: '#000000',
    ...over,
  };
}

const okImage = async () => ({
  ok: true,
  headers: { get: () => 'image/png' },
  arrayBuffer: async () => new ArrayBuffer(8),
});

function stubFetch(impl: any) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/certificates/[submissionId]', () => {
  beforeEach(() => {
    h.state.submissionRows = [];
    h.state.templateRows = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 404 when the submission does not exist', async () => {
    h.state.submissionRows = [];

    const res = await GET(req(), ctx());

    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Submission not found');
  });

  // This is the case that motivated the student-side download guard: with no
  // template configured the endpoint 404s, so the UI must not offer a link.
  it('returns 404 when the organiser never configured a template for the round', async () => {
    h.state.submissionRows = [submission()];
    h.state.templateRows = [];

    const res = await GET(req(), ctx());

    expect(res.status).toBe(404);
    expect(await res.text()).toMatch(/templates not configured/i);
  });

  it('returns 403 when the score does not reach any tier threshold', async () => {
    h.state.submissionRows = [submission({ score: '10' })];
    h.state.templateRows = [tier({ minScorePercentage: '50' })];

    const res = await GET(req(), ctx());

    expect(res.status).toBe(403);
  });

  it('selects the highest eligible tier and returns a PDF', async () => {
    h.state.submissionRows = [submission({ score: '60' })];
    // The real query orders DESC by minScorePercentage; the mock returns rows
    // already in that order, so .find() picks the first tier the score clears.
    h.state.templateRows = [
      tier({ minScorePercentage: '80', templateUrl: 'https://cdn.test/distinction.png' }),
      tier({ minScorePercentage: '50', templateUrl: 'https://cdn.test/merit.png' }),
      tier({ minScorePercentage: '0', templateUrl: 'https://cdn.test/participation.png' }),
    ];
    const fetchMock = stubFetch(okImage);

    const res = await GET(req(), ctx());

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('Ada_Lovelace');
    // score 60 skips the 80 tier and lands on the 50 (merit) tier
    expect(fetchMock).toHaveBeenCalledWith('https://cdn.test/merit.png');
    expect(h.page.drawText).toHaveBeenCalledWith(
      'Ada Lovelace',
      expect.objectContaining({ size: 48 })
    );
  });

  it('loads a PDF template directly when the file is a .pdf', async () => {
    h.state.submissionRows = [submission({ score: '90' })];
    h.state.templateRows = [
      tier({ minScorePercentage: '0', templateUrl: 'https://cdn.test/cert.pdf' }),
    ];
    stubFetch(async () => ({
      ok: true,
      headers: { get: () => 'application/pdf' },
      arrayBuffer: async () => new ArrayBuffer(8),
    }));

    const res = await GET(req(), ctx());

    expect(res.status).toBe(200);
    expect(h.PDFDocument.load).toHaveBeenCalledTimes(1);
    expect(h.PDFDocument.create).not.toHaveBeenCalled();
  });

  it('returns 500 when the template image cannot be fetched', async () => {
    h.state.submissionRows = [submission({ score: '90' })];
    h.state.templateRows = [tier({ minScorePercentage: '0' })];
    stubFetch(async () => ({ ok: false }));

    const res = await GET(req(), ctx());

    expect(res.status).toBe(500);
  });

  it('returns 400 when the template image format is unsupported', async () => {
    h.state.submissionRows = [submission({ score: '90' })];
    h.state.templateRows = [
      tier({ minScorePercentage: '0', templateUrl: 'https://cdn.test/cert.png' }),
    ];
    stubFetch(okImage);
    h.pdfDoc.embedPng.mockRejectedValueOnce(new Error('not a png'));
    h.pdfDoc.embedJpg.mockRejectedValueOnce(new Error('not a jpg'));

    const res = await GET(req(), ctx());

    expect(res.status).toBe(400);
  });
});
