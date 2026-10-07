import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { memberships, portals, questionPapers, questions, rounds } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import {
  generateMemoPdf,
  generateQuestionPaperPdf,
  type PdfQuestion,
} from '@/lib/pdf/online-test-pdf';
import { loadPaperQuestions, orderByIdsStrict } from '@/domain/question-bank/load-variant';
import { drawVariant, mulberry32 } from '@/domain/question-bank/variant-generator';
import { FIXED_SEED } from '@/domain/question-bank/publish-readiness';

// Printable round documents for schools: GET ?kind=paper|memo.
//
// - The uploaded PDF is served when the organiser provided one; otherwise the
//   document is generated from the organiser's ordered physical selection
//   (loadPaperQuestions), falling back to the whole pool for legacy papers, so
//   online and hybrid rounds can be sat on paper too.
// - Only the olympiad's organiser and its accepted educators may download.
// - The question paper is available once the round opens; the memo only once
//   it closes, so answers never circulate while entrants are still writing.
// - GET ?variant=preview (organiser/educator only) renders a sample online
//   variant drawn with the fixed seed, so they can see what an entrant gets.

/** Coerce a nullable-marks question row into the PDF's question shape. */
function toPdfQuestion(q: {
  id: string;
  questionType: any;
  prompt: any;
  marks: number | null;
  options: any;
  correctAnswer: any;
  imageUrl?: string | null;
}): PdfQuestion {
  return {
    id: q.id,
    type: q.questionType,
    prompt: q.prompt,
    // PdfQuestion.marks is non-nullable; a draft question with no mark prints
    // as 0 rather than breaking the paper total.
    marks: q.marks ?? 0,
    options: q.options,
    correctAnswer: q.correctAnswer,
    imageUrl: q.imageUrl,
  };
}

/** Build the attachment response for generated PDF bytes. */
function pdfResponse(bytes: Uint8Array, roundName: string, label: string) {
  const safeName =
    roundName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'round';
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeName}-${label}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ roundId: string }> }
) {
  const { roundId } = await params;
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') === 'memo' ? 'memo' : 'paper';
  const wantsVariantPreview = url.searchParams.get('variant') === 'preview';

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });

  const [round] = await db
    .select({
      id: rounds.id,
      name: rounds.name,
      portalId: rounds.portalId,
      opensAt: rounds.opensAt,
      closesAt: rounds.closesAt,
      targetTotalMarks: rounds.targetTotalMarks,
      portalName: portals.name,
      ownerUserId: portals.ownerUserId,
    })
    .from(rounds)
    .innerJoin(portals, eq(portals.id, rounds.portalId))
    .where(eq(rounds.id, roundId));
  if (!round) return new NextResponse('Round not found', { status: 404 });

  const isOrganiser = round.ownerUserId === user.id;
  if (!isOrganiser) {
    const [educator] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, user.id),
          eq(memberships.portalId, round.portalId),
          eq(memberships.role, 'educator'),
          eq(memberships.status, 'accepted')
        )
      );
    if (!educator) return new NextResponse('Forbidden', { status: 403 });

    const now = new Date();
    if (kind === 'paper' && now < round.opensAt) {
      return new NextResponse('The question paper is available once the round opens.', { status: 403 });
    }
    if (kind === 'memo' && now < round.closesAt) {
      return new NextResponse('The memo is available once the round closes.', { status: 403 });
    }
  }

  // Organiser/educator-only sample of ONE online variant, drawn with the fixed
  // seed so it is reproducible. Generated even when a paper PDF was uploaded,
  // and never tied to a real sitting — purely a preview of what an entrant sees.
  if (wantsVariantPreview) {
    const poolRows = await db
      .select()
      .from(questions)
      .where(eq(questions.roundId, roundId));
    if (poolRows.length === 0) {
      return new NextResponse('This round has no questions to preview.', { status: 404 });
    }
    const pool = poolRows.map((q) => ({
      id: q.id,
      marks: q.marks,
      difficulty: q.difficulty,
    }));
    const target =
      round.targetTotalMarks ?? pool.reduce((s, q) => s + (q.marks ?? 0), 0);
    const variant = drawVariant(pool, target, mulberry32(FIXED_SEED));
    // STRICT ordering: the preview must show ONLY the drawn variant's questions,
    // in variant order. The lossless `orderByIds` would append every undrawn
    // pool question after the variant — leaking the full pool (including content
    // still hidden from students mid-round) and misrepresenting what an entrant
    // actually gets. `orderByIdsStrict` drops the unreferenced rows instead.
    const ordered = orderByIdsStrict(poolRows, variant.questionIds);
    const previewBytes = await generateQuestionPaperPdf(
      ordered.map(toPdfQuestion),
      { roundName: round.name, subtitle: `${round.portalName} — sample variant` }
    );
    return pdfResponse(previewBytes, round.name, 'sample-variant');
  }

  const [paper] = await db
    .select({
      fileUrl: questionPapers.fileUrl,
      answerKeyJson: questionPapers.answerKeyJson,
      selectedQuestionIds: questionPapers.selectedQuestionIds,
    })
    .from(questionPapers)
    .where(eq(questionPapers.roundId, roundId))
    .limit(1);

  const uploadedUrl =
    kind === 'paper'
      ? paper?.fileUrl
      : (paper?.answerKeyJson as { memoUrl?: string } | null)?.memoUrl;
  if (uploadedUrl) return NextResponse.redirect(uploadedUrl);

  // No uploaded PDF: generate it from the organiser's ordered physical
  // selection. loadPaperQuestions falls back to the whole pool (insertion
  // order) for legacy papers with no selection, so behaviour is unchanged there.
  const rows = await loadPaperQuestions(
    { selectedQuestionIds: (paper?.selectedQuestionIds as string[] | null) ?? null },
    roundId
  );
  if (rows.length === 0) {
    return new NextResponse(
      kind === 'paper'
        ? 'No question paper has been uploaded for this round yet.'
        : 'No memo has been uploaded for this round yet.',
      { status: 404 }
    );
  }

  const pdfQuestions: PdfQuestion[] = rows.map(toPdfQuestion);
  const meta = { roundName: round.name, subtitle: round.portalName };
  const bytes =
    kind === 'paper'
      ? await generateQuestionPaperPdf(pdfQuestions, meta)
      : await generateMemoPdf(pdfQuestions, meta);

  return pdfResponse(bytes, round.name, kind === 'paper' ? 'question-paper' : 'memo');
}
