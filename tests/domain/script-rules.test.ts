import { describe, it, expect } from 'vitest';
import {
  buildScriptPath,
  decideScriptAccess,
  isScriptPathFor,
  MAX_PINS,
  MAX_SCRIPT_PAGE_BYTES,
  MAX_SCRIPT_PAGES,
  parseStoredPins,
  sniffImageType,
  validatePageCount,
  validatePageMeta,
  validatePaperQuery,
  validateUploadedPage,
} from '@/domain/scripts/script-rules';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = new Uint8Array([...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBPVP8 '].map((c) => c.charCodeAt(0))));
// "%PDF-" and an ISO-BMFF HEIC header ("....ftypheic")
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const HEIC = new Uint8Array([0, 0, 0, 0x18, ...[...'ftypheic'].map((c) => c.charCodeAt(0))]);

describe('decideScriptAccess', () => {
  const published = new Date('2026-09-01T10:00:00Z');

  it('lets the entrant see their own script once results are published', () => {
    expect(
      decideScriptAccess({ userId: 'u1', entrantUserId: 'u1', resultsPublishedAt: published, canMark: false })
    ).toBe(true);
  });

  it('hides it from the entrant before publication', () => {
    expect(
      decideScriptAccess({ userId: 'u1', entrantUserId: 'u1', resultsPublishedAt: null, canMark: false })
    ).toBe(false);
  });

  it('lets markers (school educator / organiser) see it at any time', () => {
    expect(
      decideScriptAccess({ userId: 'edu', entrantUserId: 'u1', resultsPublishedAt: null, canMark: true })
    ).toBe(true);
  });

  it('denies another entrant and strangers, even after publication', () => {
    expect(
      decideScriptAccess({ userId: 'u2', entrantUserId: 'u1', resultsPublishedAt: published, canMark: false })
    ).toBe(false);
    expect(
      decideScriptAccess({ userId: 'u2', entrantUserId: null, resultsPublishedAt: published, canMark: false })
    ).toBe(false);
  });
});

describe('image validation', () => {
  it('recognises JPEG, PNG and WebP by their magic bytes only', () => {
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(WEBP)).toBe('image/webp');
    expect(sniffImageType(PDF)).toBeNull();
    expect(sniffImageType(HEIC)).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });

  it('rejects disallowed types and oversized or empty pages up front', () => {
    expect(validatePageMeta({ contentType: 'image/jpeg', size: 1000 })).toBeNull();
    expect(validatePageMeta({ contentType: 'image/heic', size: 1000 })).toMatch(/HEIC/);
    expect(validatePageMeta({ contentType: 'application/pdf', size: 1000 })).toMatch(/JPEG, PNG or WebP/);
    expect(validatePageMeta({ contentType: 'image/png', size: MAX_SCRIPT_PAGE_BYTES + 1 })).toMatch(/10 MB/);
    expect(validatePageMeta({ contentType: 'image/png', size: 0 })).toMatch(/empty/);
  });

  it('limits a script to 1..30 pages', () => {
    expect(validatePageCount(0)).toMatch(/at least one/);
    expect(validatePageCount(MAX_SCRIPT_PAGES)).toBeNull();
    expect(validatePageCount(MAX_SCRIPT_PAGES + 1)).toMatch(/at most 30/);
  });

  it('checks the uploaded bytes against the claimed type', () => {
    expect(validateUploadedPage(JPEG, 'image/jpeg')).toEqual({ contentType: 'image/jpeg' });
    // A PDF renamed to .jpg
    expect(validateUploadedPage(PDF, 'image/jpeg')).toEqual({
      error: 'One of the pages is not a JPEG, PNG or WebP image.',
    });
    // A real PNG claiming to be a JPEG
    expect(validateUploadedPage(PNG, 'image/jpeg')).toEqual({
      error: 'One of the pages does not match its file type.',
    });
    const huge = new Uint8Array(MAX_SCRIPT_PAGE_BYTES + 1);
    huge.set(JPEG);
    expect(validateUploadedPage(huge, 'image/jpeg')).toEqual({
      error: 'Each page must be 10 MB or smaller.',
    });
  });
});

describe('script storage paths', () => {
  const round = '11111111-1111-4111-8111-111111111111';
  const sub = '22222222-2222-4222-8222-222222222222';
  const obj = '33333333-3333-4333-8333-333333333333';

  it('builds {roundId}/{submissionId}/{kind}/{uuid}.{ext}', () => {
    expect(buildScriptPath(round, sub, 'original', obj, 'image/webp')).toBe(
      `${round}/${sub}/original/${obj}.webp`
    );
  });

  it('only accepts paths for the same round, submission and kind', () => {
    const path = buildScriptPath(round, sub, 'original', obj, 'image/jpeg');
    expect(isScriptPathFor(path, round, sub, 'original')).toBe(true);
    expect(isScriptPathFor(path, round, 'other-sub', 'original')).toBe(false);
    expect(isScriptPathFor(path, round, sub, 'remarked')).toBe(false);
    expect(isScriptPathFor(`${round}/${sub}/original/../x.jpg`, round, sub, 'original')).toBe(false);
    expect(isScriptPathFor(`${round}/${sub}/original/${obj}.pdf`, round, sub, 'original')).toBe(false);
  });
});

describe('validatePaperQuery', () => {
  const pin = (over: Partial<{ page: number; x: number; y: number; note: string }> = {}) => ({
    page: 0, x: 0.5, y: 0.5, note: 'Check my working', ...over,
  });

  it('accepts question refs and pins, trimming text', () => {
    expect(validatePaperQuery({ questionRefs: '  Q3, Q5b ', pins: [pin({ note: ' here ' })] }, 2)).toEqual({
      questionRefs: 'Q3, Q5b',
      pins: [{ page: 0, x: 0.5, y: 0.5, note: 'here' }],
    });
  });

  it('stores nothing when the entrant gave no refs or pins', () => {
    expect(validatePaperQuery({}, 0)).toEqual({ questionRefs: null, pins: null });
  });

  it('limits question refs to 200 characters', () => {
    expect(validatePaperQuery({ questionRefs: 'Q'.repeat(201) }, 1)).toHaveProperty('error');
    expect(validatePaperQuery({ questionRefs: 'Q'.repeat(200) }, 1)).not.toHaveProperty('error');
  });

  it('limits the number of pins', () => {
    const pins = Array.from({ length: MAX_PINS + 1 }, () => pin());
    expect(validatePaperQuery({ pins }, 1)).toEqual({ error: `You can add at most ${MAX_PINS} pins.` });
  });

  it('rejects coordinates outside the page', () => {
    for (const bad of [pin({ x: -0.01 }), pin({ y: 1.01 }), pin({ x: Number.NaN })]) {
      expect(validatePaperQuery({ pins: [bad] }, 1)).toEqual({ error: 'Pin 1 is outside the page.' });
    }
    expect(validatePaperQuery({ pins: [pin({ x: 0, y: 1 })] }, 1)).not.toHaveProperty('error');
  });

  it('rejects pins past the last page or on fractional pages', () => {
    expect(validatePaperQuery({ pins: [pin({ page: 2 })] }, 2)).toEqual({
      error: 'Pin 1 is not on a page of your script.',
    });
    expect(validatePaperQuery({ pins: [pin({ page: 0.5 })] }, 2)).toHaveProperty('error');
    expect(validatePaperQuery({ pins: [pin({ page: -1 })] }, 2)).toHaveProperty('error');
  });

  it('rejects pins when there is no script', () => {
    expect(validatePaperQuery({ pins: [pin()] }, 0)).toEqual({
      error: 'Pins can only be added once your script has been uploaded.',
    });
  });

  it('limits pin notes to 300 characters', () => {
    expect(validatePaperQuery({ pins: [pin(), pin({ note: 'n'.repeat(301) })] }, 1)).toEqual({
      error: "Keep pin 2's note under 300 characters.",
    });
  });

  it('rejects malformed pins', () => {
    expect(validatePaperQuery({ pins: 'nope' }, 1)).toEqual({ error: 'Pins are invalid.' });
    expect(validatePaperQuery({ pins: [null] }, 1)).toEqual({ error: 'Pin 1 is invalid.' });
  });

  it('parses stored pins defensively for display', () => {
    expect(parseStoredPins(null)).toEqual([]);
    expect(parseStoredPins([pin(), { page: 'x' }])).toEqual([pin()]);
  });
});
