import { db } from '@/lib/db';
import { rounds, submissions, users, memberships, certificateTemplates, results } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { NextResponse } from 'next/server';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ submissionId: string }> }
) {
  const { submissionId } = await params;

  // 1. Fetch submission and student name
  const [submissionData] = await db
    .select({
      roundId: submissions.roundId,
      studentName: users.name,
      invitedEmail: memberships.invitedEmail,
      score: results.score,
    })
    .from(submissions)
    .innerJoin(memberships, eq(submissions.studentMembershipId, memberships.id))
    .leftJoin(users, eq(memberships.userId, users.id))
    .leftJoin(results, eq(submissions.id, results.submissionId))
    .where(eq(submissions.id, submissionId));

  if (!submissionData) {
    return new NextResponse('Submission not found', { status: 404 });
  }

  // 2. Fetch templates for this round, ordered by minScorePercentage DESC
  const templates = await db
    .select()
    .from(certificateTemplates)
    .where(eq(certificateTemplates.roundId, submissionData.roundId))
    .orderBy(desc(certificateTemplates.minScorePercentage));

  if (templates.length === 0) {
    return new NextResponse('Certificate templates not configured for this round', { status: 404 });
  }

  const studentScore = parseFloat(submissionData.score as string) || 0;
  
  // Find highest eligible tier
  const eligibleTemplate = templates.find(t => studentScore >= parseFloat(t.minScorePercentage as string));

  if (!eligibleTemplate) {
    return new NextResponse('Student score does not qualify for any certificate tier', { status: 403 });
  }

  const nameToDraw = submissionData.studentName || submissionData.invitedEmail || 'Student';

  // 3. Fetch the image buffer
  const imageResponse = await fetch(eligibleTemplate.templateUrl);
  if (!imageResponse.ok) {
    return new NextResponse('Failed to fetch certificate template image', { status: 500 });
  }
  
  const imageBuffer = await imageResponse.arrayBuffer();

  // 4. Create or Load PDF with pdf-lib
  let pdfDoc;
  let page;
  let width, height;

  if (eligibleTemplate.templateUrl.toLowerCase().includes('.pdf') || imageResponse.headers.get('content-type') === 'application/pdf') {
    pdfDoc = await PDFDocument.load(imageBuffer);
    const pages = pdfDoc.getPages();
    page = pages[0];
    const size = page.getSize();
    width = size.width;
    height = size.height;
  } else {
    pdfDoc = await PDFDocument.create();
    let image;
    try {
      image = await pdfDoc.embedPng(imageBuffer);
    } catch (e) {
      try {
        image = await pdfDoc.embedJpg(imageBuffer);
      } catch (err) {
        return new NextResponse('Unsupported image format. Please use PNG, JPG, or PDF.', { status: 400 });
      }
    }

    const scaled = image.scale(1);
    width = scaled.width;
    height = scaled.height;
    page = pdfDoc.addPage([width, height]);
    page.drawImage(image, { x: 0, y: 0, width, height });
  }

  // 5. Calculate coordinates and draw text
  const xPercent = parseFloat(eligibleTemplate.nameXCoord as string) || 50;
  const yPercent = parseFloat(eligibleTemplate.nameYCoord as string) || 50;
  
  const fontSize = eligibleTemplate.nameFontSize || 48;
  const colorHex = (eligibleTemplate.nameTextColor || '#000000').replace('#', '');
  
  const r = parseInt(colorHex.substring(0, 2), 16) / 255;
  const g = parseInt(colorHex.substring(2, 4), 16) / 255;
  const b = parseInt(colorHex.substring(4, 6), 16) / 255;

  const actualX = (xPercent / 100) * width;
  // Convert top-left Y to bottom-left Y
  const actualY = height - ((yPercent / 100) * height);

  // We need a font to measure text width for center alignment
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const textWidth = font.widthOfTextAtSize(nameToDraw, fontSize);
  const textHeight = font.heightAtSize(fontSize);

  page.drawText(nameToDraw, {
    // Center the text on the X coordinate
    x: actualX - (textWidth / 2),
    // Center the text vertically on the Y coordinate
    y: actualY - (fontSize / 3),
    size: fontSize,
    font,
    color: rgb(r, g, b),
  });

  const pdfBytes = await pdfDoc.save();

  // pdf-lib types save() as Uint8Array<ArrayBufferLike>, which lib.dom's
  // BodyInit does not accept; re-wrap it in a plain Uint8Array.
  return new NextResponse(new Uint8Array(pdfBytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="certificate-${nameToDraw.replace(/[^a-z0-9]/gi, '_')}.pdf"`,
    },
  });
}
