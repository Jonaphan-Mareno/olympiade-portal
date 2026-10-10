// Pure rules for marked paper scripts: what may be uploaded, where it is
// stored, who may see it, and what a paper-remark query may contain. No db or
// storage here, so the server actions, the API route and the UI all agree and
// the rules are unit-testable on their own.

// Private Storage bucket holding the page images (never public URLs)
export const MARKED_SCRIPTS_BUCKET = 'marked-scripts';

export const MAX_SCRIPT_PAGES = 30;
export const MAX_SCRIPT_PAGE_BYTES = 10 * 1024 * 1024;
export const MAX_QUESTION_REFS_LENGTH = 200;
export const MAX_PIN_NOTE_LENGTH = 300;
export const MAX_PINS = 10;

export type ScriptKind = 'original' | 'remarked';
export type ScriptImageType = 'image/jpeg' | 'image/png' | 'image/webp';

export const SCRIPT_IMAGE_TYPES: Record<ScriptImageType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function isScriptImageType(type: string): type is ScriptImageType {
  return Object.prototype.hasOwnProperty.call(SCRIPT_IMAGE_TYPES, type);
}

/**
 * The real image type from the file's first bytes, whatever the browser
 * claimed. Only JPEG, PNG and WebP are recognised.
 */
export function sniffImageType(bytes: Uint8Array): ScriptImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) return 'image/png';
  // RIFF....WEBP
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/** Checks the claimed type and size of one page before it is uploaded. */
export function validatePageMeta(file: { contentType: string; size: number }): string | null {
  if (!isScriptImageType(file.contentType)) {
    return 'Scripts must be JPEG, PNG or WebP photos. HEIC and PDF files are not supported.';
  }
  if (!Number.isInteger(file.size) || file.size <= 0) return 'One of the pages is empty.';
  if (file.size > MAX_SCRIPT_PAGE_BYTES) return 'Each page must be 10 MB or smaller.';
  return null;
}

export function validatePageCount(count: number): string | null {
  if (count < 1) return 'Add at least one page.';
  if (count > MAX_SCRIPT_PAGES) return `A script can have at most ${MAX_SCRIPT_PAGES} pages.`;
  return null;
}

/**
 * Checks an uploaded page's actual bytes: the magic bytes must be an allowed
 * image type and agree with what was claimed, and the size must be in range.
 */
export function validateUploadedPage(
  bytes: Uint8Array,
  claimedType: string
): { error: string } | { contentType: ScriptImageType } {
  const sniffed = sniffImageType(bytes);
  if (!sniffed) {
    return { error: 'One of the pages is not a JPEG, PNG or WebP image.' };
  }
  if (sniffed !== claimedType) {
    return { error: 'One of the pages does not match its file type.' };
  }
  const metaError = validatePageMeta({ contentType: sniffed, size: bytes.length });
  if (metaError) return { error: metaError };
  return { contentType: sniffed };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Storage key for one page: {roundId}/{submissionId}/{kind}/{uuid}.{ext} */
export function buildScriptPath(
  roundId: string,
  submissionId: string,
  kind: ScriptKind,
  objectId: string,
  contentType: ScriptImageType
): string {
  return `${roundId}/${submissionId}/${kind}/${objectId}.${SCRIPT_IMAGE_TYPES[contentType]}`;
}

/**
 * Whether a client-supplied storage path is one this server could have issued
 * for that submission and kind, so a commit can never attach another
 * entrant's objects.
 */
export function isScriptPathFor(
  path: string,
  roundId: string,
  submissionId: string,
  kind: ScriptKind
): boolean {
  const parts = path.split('/');
  if (parts.length !== 4) return false;
  const [r, s, k, file] = parts;
  const match = /^([0-9a-f-]{36})\.(jpg|png|webp)$/i.exec(file);
  return r === roundId && s === submissionId && k === kind && !!match && isUuid(match[1]);
}

export type ScriptPin = { page: number; x: number; y: number; note: string };

export type PaperQueryInput = { questionRefs?: string | null; pins?: unknown };

/**
 * Validates a paper-remark query: free-text question references and optional
 * numbered pins on the entrant's original script pages. `pageCount` is the
 * number of original pages, so a pin can't point past the script.
 */
export function validatePaperQuery(
  input: PaperQueryInput,
  pageCount: number
): { error: string } | { questionRefs: string | null; pins: ScriptPin[] | null } {
  const refs = (input.questionRefs ?? '').trim();
  if (refs.length > MAX_QUESTION_REFS_LENGTH) {
    return { error: `Keep the question numbers under ${MAX_QUESTION_REFS_LENGTH} characters.` };
  }

  const raw = input.pins ?? [];
  if (!Array.isArray(raw)) return { error: 'Pins are invalid.' };
  if (raw.length > MAX_PINS) return { error: `You can add at most ${MAX_PINS} pins.` };
  if (raw.length > 0 && pageCount === 0) {
    return { error: 'Pins can only be added once your script has been uploaded.' };
  }

  const pins: ScriptPin[] = [];
  for (const [i, p] of raw.entries()) {
    const pin = p as Partial<ScriptPin> | null;
    const n = i + 1;
    if (!pin || typeof pin !== 'object') return { error: `Pin ${n} is invalid.` };
    const { page, x, y } = pin;
    if (typeof page !== 'number' || !Number.isInteger(page) || page < 0 || page >= pageCount) {
      return { error: `Pin ${n} is not on a page of your script.` };
    }
    if (
      typeof x !== 'number' || typeof y !== 'number' ||
      !Number.isFinite(x) || !Number.isFinite(y) ||
      x < 0 || x > 1 || y < 0 || y > 1
    ) {
      return { error: `Pin ${n} is outside the page.` };
    }
    const note = typeof pin.note === 'string' ? pin.note.trim() : '';
    if (note.length > MAX_PIN_NOTE_LENGTH) {
      return { error: `Keep pin ${n}'s note under ${MAX_PIN_NOTE_LENGTH} characters.` };
    }
    pins.push({ page, x, y, note });
  }

  return { questionRefs: refs || null, pins: pins.length > 0 ? pins : null };
}

/** Stored pins, defensively parsed for display. */
export function parseStoredPins(value: unknown): ScriptPin[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (p): p is ScriptPin =>
      !!p &&
      typeof p.page === 'number' &&
      typeof p.x === 'number' &&
      typeof p.y === 'number' &&
      typeof p.note === 'string'
  );
}

/**
 * Who may see a page of a marked script. Same rule for 'original' and
 * 'remarked' pages:
 *   - the entrant who owns the submission, once results are published;
 *   - whoever may resolve a remark for it (accepted educator of the entrant's
 *     school in that olympiad, or the olympiad's organiser — `canMark`, from
 *     canResolveRemark), at any time.
 */
export function decideScriptAccess(params: {
  userId: string;
  entrantUserId: string | null;
  resultsPublishedAt: Date | null;
  canMark: boolean;
}): boolean {
  if (params.canMark) return true;
  return (
    params.entrantUserId !== null &&
    params.entrantUserId === params.userId &&
    params.resultsPublishedAt !== null
  );
}
