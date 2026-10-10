import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from 'pdf-lib';

/**
 * Minimal shape of a question as produced by QuestionBuilder.
 */
export interface PdfQuestion {
  id: string;
  type: string;
  prompt: string;
  marks: number | string;
  options: any;
  correctAnswer: any;
  imageUrl?: string | null;
}

export interface TestPdfMeta {
  roundName: string;
  /** Optional extra heading line, e.g. the olympiad name. */
  subtitle?: string;
}

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 56;
const CONTENT_W = PAGE_W - MARGIN * 2;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const letter = (i: number) => LETTERS[i] ?? String(i + 1);
const marksOf = (q: PdfQuestion) => Number(q.marks) || 1;

/**
 * Deterministic shuffle so the paper and memo agree on the order of the
 * matching responses without needing to persist anything.
 */
function seededOrder(length: number, seed: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rand = () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const order = Array.from({ length }, (_, i) => i);
  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

class Writer {
  page!: PDFPage;
  y = 0;

  constructor(
    private doc: PDFDocument,
    private font: PDFFont,
    private bold: PDFFont,
    private footer: string
  ) {
    this.newPage();
  }

  private chars = new Set<number>();

  private clean(text: string): string {
    if (this.chars.size === 0) {
      this.font.getCharacterSet().forEach((c) => this.chars.add(c));
    }
    let out = '';
    for (const ch of (text ?? '').replace(/\t/g, '    ').replace(/\r/g, '')) {
      if (ch === '\n') out += ch;
      else out += this.chars.has(ch.codePointAt(0)!) ? ch : '?';
    }
    return out;
  }

  newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - MARGIN;
  }

  ensure(height: number) {
    if (this.y - height < MARGIN) this.newPage();
  }

  space(h: number) {
    this.y -= h;
  }

  private wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const lines: string[] = [];
    for (const para of this.clean(text).split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= width) {
          line = candidate;
        } else {
          if (line) lines.push(line);
          line = word;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  text(
    text: string,
    opts: { size?: number; bold?: boolean; indent?: number; gap?: number; color?: [number, number, number] } = {}
  ) {
    const size = opts.size ?? 11;
    const font = opts.bold ? this.bold : this.font;
    const indent = opts.indent ?? 0;
    const lineH = size * 1.35;
    const lines = this.wrap(text, font, size, CONTENT_W - indent);
    for (const l of lines) {
      this.ensure(lineH);
      this.y -= lineH;
      const c = opts.color ?? [0, 0, 0];
      this.page.drawText(l, { x: MARGIN + indent, y: this.y, size, font, color: rgb(c[0], c[1], c[2]) });
    }
    this.y -= opts.gap ?? 0;
  }

  /** Right-aligned text on the current baseline (used for marks). */
  rightText(text: string, size = 10) {
    const w = this.font.widthOfTextAtSize(this.clean(text), size);
    this.page.drawText(this.clean(text), {
      x: PAGE_W - MARGIN - w,
      y: this.y,
      size,
      font: this.font,
      color: rgb(0.25, 0.25, 0.25),
    });
  }

  rule() {
    this.ensure(10);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_W - MARGIN, y: this.y },
      thickness: 0.7,
      color: rgb(0.7, 0.7, 0.7),
    });
    this.y -= 10;
  }

  answerLines(count: number) {
    for (let i = 0; i < count; i++) {
      this.ensure(22);
      this.y -= 22;
      this.page.drawLine({
        start: { x: MARGIN + 18, y: this.y },
        end: { x: PAGE_W - MARGIN, y: this.y },
        thickness: 0.5,
        color: rgb(0.6, 0.6, 0.6),
      });
    }
    this.y -= 6;
  }

  image(img: PDFImage) {
    const maxW = CONTENT_W - 18;
    const maxH = 220;
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = img.width * scale;
    const h = img.height * scale;
    this.ensure(h + 8);
    this.y -= h;
    this.page.drawImage(img, { x: MARGIN + 18, y: this.y, width: w, height: h });
    this.y -= 8;
  }

  finish() {
    const pages = this.doc.getPages();
    pages.forEach((p, i) => {
      const label = `${this.clean(this.footer)}  |  Page ${i + 1} of ${pages.length}`;
      const w = this.font.widthOfTextAtSize(label, 8);
      p.drawText(label, {
        x: (PAGE_W - w) / 2,
        y: 28,
        size: 8,
        font: this.font,
        color: rgb(0.45, 0.45, 0.45),
      });
    });
  }
}

async function loadImage(doc: PDFDocument, url: string): Promise<PDFImage | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
    const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    if (isPng) return await doc.embedPng(bytes);
    if (isJpg) return await doc.embedJpg(bytes);
    return null; // unsupported format (gif/webp/svg) - skip rather than fail
  } catch {
    return null;
  }
}

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string' && value.trim() !== '') return [value];
  return [];
}

async function createDoc(title: string) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return { doc, font, bold };
}

function header(w: Writer, title: string, meta: TestPdfMeta, questions: PdfQuestion[], paper: boolean) {
  w.text(title, { size: 20, bold: true, gap: 2 });
  if (meta.subtitle) w.text(meta.subtitle, { size: 11, color: [0.3, 0.3, 0.3] });
  const total = questions.reduce((s, q) => s + marksOf(q), 0);
  w.text(`Total marks: ${total}`, { size: 11, bold: true, gap: 6 });
  if (paper) {
    w.text('Name: ______________________________    Student No.: ____________________', { size: 11, gap: 4 });
    w.text('Answer all questions. Write your answers clearly in the space provided.', {
      size: 9,
      color: [0.35, 0.35, 0.35],
      gap: 4,
    });
  }
  w.rule();
  w.space(4);
}

/**
 * Printable question paper. Never contains any answers.
 */
export async function generateQuestionPaperPdf(
  questions: PdfQuestion[],
  meta: TestPdfMeta,
  imageOverrides: Record<string, string> = {}
): Promise<Uint8Array> {
  const { doc, font, bold } = await createDoc(`${meta.roundName} - Question Paper`);
  const w = new Writer(doc, font, bold, `${meta.roundName} - Question Paper`);
  header(w, meta.roundName, meta, questions, true);

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    w.ensure(60);
    w.text(`Question ${i + 1}`, { bold: true, size: 12 });
    // Marks on the heading line (baseline of the line just written).
    w.rightText(`[${marksOf(q)} mark${marksOf(q) === 1 ? '' : 's'}]`);
    w.space(2);
    w.text(q.prompt || '', { gap: 4 });

    const imageUrl = imageOverrides[q.id] || q.imageUrl;
    if (imageUrl) {
      const img = await loadImage(doc, imageUrl);
      if (img) w.image(img);
    }

    const opts: any[] = Array.isArray(q.options) ? q.options : [];
    switch (q.type) {
      case 'single_choice':
        w.text('Choose ONE answer.', { size: 9, color: [0.4, 0.4, 0.4], indent: 18 });
        opts.forEach((o, oi) => w.text(`${letter(oi)}.  ${String(o)}`, { indent: 18 }));
        break;
      case 'multiple_choice':
        w.text('Choose ALL correct answers.', { size: 9, color: [0.4, 0.4, 0.4], indent: 18 });
        opts.forEach((o, oi) => w.text(`${letter(oi)}.  ${String(o)}`, { indent: 18 }));
        break;
      case 'true_false':
        w.text('Circle one:   True   /   False', { indent: 18 });
        break;
      case 'matching': {
        w.text('Match each item in Column A with the correct item in Column B (write the letter).', {
          size: 9,
          color: [0.4, 0.4, 0.4],
          indent: 18,
        });
        const order = seededOrder(opts.length, q.id);
        w.text('Column A', { bold: true, indent: 18 });
        opts.forEach((p, pi) => w.text(`${pi + 1}.  ${p?.premise ?? ''}   ->  ______`, { indent: 18 }));
        w.space(4);
        w.text('Column B', { bold: true, indent: 18 });
        order.forEach((origIdx, pos) => w.text(`${letter(pos)}.  ${opts[origIdx]?.response ?? ''}`, { indent: 18 }));
        break;
      }
      case 'free_text':
      default:
        w.answerLines(Math.min(8, Math.max(3, Math.ceil(marksOf(q) / 1.5) + 2)));
        break;
    }
    w.space(14);
  }

  w.finish();
  return doc.save();
}

/**
 * Separate memo (answer key) built from the answers chosen in the builder.
 */
export async function generateMemoPdf(
  questions: PdfQuestion[],
  meta: TestPdfMeta
): Promise<Uint8Array> {
  const { doc, font, bold } = await createDoc(`${meta.roundName} - Memo`);
  const w = new Writer(doc, font, bold, `${meta.roundName} - Memo (CONFIDENTIAL)`);
  header(w, `${meta.roundName} - MEMO`, meta, questions, false);
  w.text('CONFIDENTIAL: for markers only. Do not distribute to students.', {
    size: 9,
    bold: true,
    color: [0.7, 0.1, 0.1],
    gap: 10,
  });

  questions.forEach((q, i) => {
    const opts: any[] = Array.isArray(q.options) ? q.options : [];
    w.ensure(40);
    w.text(`Question ${i + 1}`, { bold: true, size: 12 });
    w.rightText(`[${marksOf(q)} mark${marksOf(q) === 1 ? '' : 's'}]`);
    w.space(2);

    switch (q.type) {
      case 'single_choice':
      case 'multiple_choice': {
        const correct = toArray(q.correctAnswer);
        const parts = correct.map((c) => {
          const idx = opts.findIndex((o) => String(o) === c);
          return idx >= 0 ? `${letter(idx)}.  ${c}` : c;
        });
        w.text(parts.length ? parts.join('\n') : '(no answer selected)', { indent: 18 });
        break;
      }
      case 'true_false':
        w.text(toArray(q.correctAnswer)[0] ?? '(no answer selected)', { indent: 18 });
        break;
      case 'matching': {
        const order = seededOrder(opts.length, q.id);
        opts.forEach((p, pi) => {
          const pos = order.indexOf(pi);
          w.text(`${pi + 1}.  ${p?.premise ?? ''}  ->  ${letter(pos)}.  ${p?.response ?? ''}`, { indent: 18 });
        });
        break;
      }
      case 'free_text':
      default:
        w.text(toArray(q.correctAnswer)[0] ?? '(no marking guideline provided)', { indent: 18 });
        break;
    }
    w.space(12);
  });

  w.finish();
  return doc.save();
}

/** Trigger a browser download for generated PDF bytes. */
export function downloadPdf(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
