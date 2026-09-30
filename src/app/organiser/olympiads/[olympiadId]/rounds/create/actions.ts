'use server';

import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { rounds, questionPapers, questions } from '@/lib/db/schema';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

export async function createRound(formData: FormData) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  // Extract Form Data
  const portalId = formData.get('portalId') as string;
  const name = formData.get('name') as string;
  const orderIndex = parseInt(formData.get('orderIndex') as string, 10);
  const opensAt = formData.get('opensAt') as string;
  const closesAt = formData.get('closesAt') as string;
  const deliveryMethod = formData.get('deliveryMethod') as 'paper' | 'online' | 'hybrid';
  const parseSAST = (dateStr: string) => new Date(`${dateStr}+02:00`);

  if (new Date(closesAt) <= new Date(opensAt)) {
    throw new Error('Closing time must be after the opening time.');
  }

  // The test time limit is derived from the round window (open -> close) rather
  // than entered by hand, so it can never disagree with the published schedule.
  // The create-round form no longer submits a durationMinutes field.
  const durationMinutes = Math.max(
    1,
    Math.round((parseSAST(closesAt).getTime() - parseSAST(opensAt).getTime()) / 60000)
  );

  const qualifyingThresholdRaw = formData.get('qualifyingThreshold') as string | null;
  const thresholdTopNRaw = formData.get('thresholdTopN') as string | null;
  const qualifyingThreshold =
    qualifyingThresholdRaw && qualifyingThresholdRaw.trim() !== ''
      ? qualifyingThresholdRaw.trim()
      : null;
  const thresholdTopN =
    thresholdTopNRaw && thresholdTopNRaw.trim() !== ''
      ? parseInt(thresholdTopNRaw.trim(), 10)
      : null;

  // ---------------------------------------------------------------------------
  // All Supabase Storage uploads happen BEFORE any database write. Storage
  // objects cannot be rolled back, so doing them first means a later DB failure
  // never leaves an orphaned round behind (at worst we leak an unused file).
  // ---------------------------------------------------------------------------

  // 1. Question paper PDF (paper / hybrid rounds)
  let paperUrl: string | null = null;
  if (deliveryMethod === 'paper' || deliveryMethod === 'hybrid') {
    const questionPaperFile = formData.get('questionPaper') as File | null;
    if (!questionPaperFile || questionPaperFile.size === 0) {
      throw new Error('A question paper PDF is required for paper or hybrid rounds.');
    }

    const fileExtension = questionPaperFile.name.split('.').pop() || 'pdf';
    const uniqueFileName = `papers/${crypto.randomUUID()}.${fileExtension}`;

    const { error: uploadError } = await supabase.storage
      .from('round-documents')
      .upload(uniqueFileName, questionPaperFile, {
        contentType: 'application/pdf',
      });

    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

    const { data: publicUrlData } = supabase.storage
      .from('round-documents')
      .getPublicUrl(uniqueFileName);
    paperUrl = publicUrlData.publicUrl;
  }

  // 2. Online questions (online / hybrid rounds): validate, upload any images,
  //    and build the rows we will insert inside the transaction below.
  const questionInserts: Array<{
    questionType: any;
    prompt: any;
    imageUrl: string | null;
    marks: number;
    options: any;
    correctAnswer: any;
  }> = [];

  if (deliveryMethod === 'online' || deliveryMethod === 'hybrid') {
    const questionsDataStr = formData.get('questionsData') as string;
    const questionsArray = JSON.parse(questionsDataStr || '[]');

    // Validate that questions have correct answers/marking guidelines
    for (let i = 0; i < questionsArray.length; i++) {
      const q = questionsArray[i];
      if (q.type === 'free_text') {
        if (!q.correctAnswer || (typeof q.correctAnswer === 'string' && q.correctAnswer.trim() === '')) {
          throw new Error(`Question ${i + 1} requires marking guidelines/answers for the educator.`);
        }
      } else if (q.type === 'single_choice' || q.type === 'multiple_choice' || q.type === 'true_false') {
        let hasAnswer = false;
        if (Array.isArray(q.correctAnswer)) {
          hasAnswer = q.correctAnswer.length > 0;
          if (hasAnswer && q.options) {
            const allValid = q.correctAnswer.every((ans: string) => q.options.includes(ans));
            if (!allValid) hasAnswer = false;
          }
        } else if (typeof q.correctAnswer === 'string' && q.correctAnswer.trim() !== '') {
          if (q.options) {
            hasAnswer = q.options.includes(q.correctAnswer);
          } else {
            hasAnswer = true;
          }
        }

        if (!hasAnswer) {
          throw new Error(`Question ${i + 1} requires an answer to be selected from the options for auto-marking.`);
        }
      } else if (q.type === 'matching') {
        if (!q.options || q.options.length === 0) {
          throw new Error(`Question ${i + 1} requires matching pairs.`);
        }
      }
    }

    const prepared = await Promise.all(
      questionsArray.map(async (q: any) => {
        let imageUrl: string | null = q.imageUrl || null;
        const imageFile = formData.get(`image_${q.id}`) as File | null;

        if (imageFile && imageFile.size > 0) {
          const fileExtension = imageFile.name.split('.').pop() || 'png';
          const uniqueFileName = `${crypto.randomUUID()}.${fileExtension}`;

          const { error: uploadError } = await supabase.storage
            .from('question-images')
            .upload(uniqueFileName, imageFile, {
              contentType: imageFile.type,
            });

          if (!uploadError) {
            const { data } = supabase.storage
              .from('question-images')
              .getPublicUrl(uniqueFileName);
            imageUrl = data.publicUrl;
          } else {
            console.error('Failed to upload image:', uploadError);
          }
        }

        return {
          questionType: q.type,
          prompt: q.prompt,
          imageUrl,
          // `questions.marks` is an integer NOT NULL column, but the builder
          // hands us a string (default ''), so coerce with a sane fallback.
          marks: Number(q.marks) || 1,
          options: q.options || null,
          correctAnswer: q.correctAnswer || null,
        };
      })
    );

    questionInserts.push(...prepared);
  }

  // ---------------------------------------------------------------------------
  // Single atomic transaction: the round, its question paper and its questions
  // are all committed together, or none of them are. This is what prevents a
  // half-created round when a later insert fails.
  // ---------------------------------------------------------------------------
  const newRound = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(rounds)
      .values({
        portalId,
        name,
        orderIndex,
        deliveryMethod,
        opensAt: parseSAST(opensAt),
        closesAt: parseSAST(closesAt),
        qualifyingThreshold: qualifyingThreshold ?? undefined,
        thresholdTopN: thresholdTopN ?? undefined,
      })
      .returning({ id: rounds.id });

    if (!created) throw new Error('Failed to create round');

    // A question paper row is required for every delivery method: online
    // sittings reference it (and its durationMinutes), paper/hybrid store the
    // uploaded PDF URL here.
    await tx.insert(questionPapers).values({
      roundId: created.id,
      fileUrl: paperUrl,
      durationMinutes,
      answerKeyJson: null,
      isMultipleChoice: false,
    });

    if (questionInserts.length > 0) {
      await tx.insert(questions).values(
        questionInserts.map((q) => ({ ...q, roundId: created.id }))
      );
    }

    return created;
  });

  if (!newRound) throw new Error('Failed to create round');

  revalidatePath(`/organiser/olympiads/${portalId}`);
  redirect(`/organiser/olympiads/${portalId}`);
}
