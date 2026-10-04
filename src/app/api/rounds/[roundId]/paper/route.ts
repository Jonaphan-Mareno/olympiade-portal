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

// Printable round documents for schools: GET ?kind=paper|memo.
//
// - The uploaded PDF is served when the organiser provided one; otherwise the
//   document is generated from the round's question bank, so online and
//   hybrid rounds can be sat on paper too.
// - Only the olympiad's organiser and its accepted educators may download.
// - The question paper is available once the round opens; the memo only once
//   it closes, so answers never circulate while entrants are still writing.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ roundId: string }> }
) {
  const { roundId } = await params;
  const kind = new URL(request.url).searchParams.get('kind') === 'memo' ? 'memo' : 'paper';

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

  const [paper] = await db
    .select({ fileUrl: questionPapers.fileUrl, answerKeyJson: questionPapers.answerKeyJson })
    .from(questionPapers)
    .where(eq(questionPapers.roundId, roundId))
    .limit(1);

  const uploadedUrl =
    kind === 'paper'
      ? paper?.fileUrl
      : (paper?.answerKeyJson as { memoUrl?: string } | null)?.memoUrl;
  if (uploadedUrl) return NextResponse.redirect(uploadedUrl);

  const rows = await db.select().from(questions).where(eq(questions.roundId, roundId));
  if (rows.length === 0) {
    return new NextResponse(
      kind === 'paper'
        ? 'No question paper has been uploaded for this round yet.'
        : 'No memo has been uploaded for this round yet.',
      { status: 404 }
    );
  }

  const pdfQuestions: PdfQuestion[] = rows.map((q) => ({
    id: q.id,
    type: q.questionType,
    prompt: q.prompt,
    marks: q.marks,
    options: q.options,
    correctAnswer: q.correctAnswer,
    imageUrl: q.imageUrl,
  }));
  const meta = { roundName: round.name, subtitle: round.portalName };
  const bytes =
    kind === 'paper'
      ? await generateQuestionPaperPdf(pdfQuestions, meta)
      : await generateMemoPdf(pdfQuestions, meta);

  const safeName = round.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'round';
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeName}-${kind === 'paper' ? 'question-paper' : 'memo'}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
