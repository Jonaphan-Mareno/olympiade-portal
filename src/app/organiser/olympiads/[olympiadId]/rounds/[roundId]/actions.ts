'use server';

import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  rounds,
  questions,
  questionPapers,
  examSittings,
} from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

export async function updateRound(formData: FormData) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  // Extract Form Data
  const portalId = formData.get('portalId') as string;
  const roundId = formData.get('roundId') as string;
  const name = formData.get('name') as string;
  const orderIndex = parseInt(formData.get('orderIndex') as string, 10);
  const opensAt = formData.get('opensAt') as string;
  const closesAt = formData.get('closesAt') as string;
  const deliveryMethod = formData.get('deliveryMethod') as 'paper' | 'online';
  const durationMinutes = Math.max(1, parseInt((formData.get('durationMinutes') as string) || '60', 10));

  // Update the Round
  await db
    .update(rounds)
    .set({
      name,
      orderIndex,
      opensAt: new Date(opensAt),
      closesAt: new Date(closesAt),
    })
    .where(eq(rounds.id, roundId));

  if (deliveryMethod === 'online') {
    // Check if any student has started the exam
    let paper = await db
      .select()
      .from(questionPapers)
      .where(eq(questionPapers.roundId, roundId))
      .limit(1);

    let hasLiveSittings = false;
    if (paper && paper.length > 0) {
      const sittings = await db
        .select()
        .from(examSittings)
        .where(eq(examSittings.questionPaperId, paper[0].id))
        .limit(1);
      hasLiveSittings = sittings.length > 0;
    }

    if (hasLiveSittings) {
      throw new Error(
        'This round cannot be edited because students have already begun their attempts.'
      );
    }

    if (paper.length === 0) {
      await db.insert(questionPapers).values({ roundId, durationMinutes });
      paper = await db.select().from(questionPapers).where(eq(questionPapers.roundId, roundId)).limit(1);
    } else {
      await db.update(questionPapers).set({ durationMinutes }).where(eq(questionPapers.id, paper[0].id));
    }

    const questionsDataStr = formData.get('questionsData') as string;
    const questionsArray = JSON.parse(questionsDataStr || '[]');

    // Delete existing questions
    await db.delete(questions).where(eq(questions.roundId, roundId));

    // Re-insert new questions
    if (questionsArray.length > 0) {
      const inserts = await Promise.all(
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
            roundId: roundId,
            questionType: q.type,
            prompt: q.prompt,
            imageUrl,
            marks: q.marks,
            options: q.options || null,
            correctAnswer: q.correctAnswer || null,
          };
        })
      );

      await db.insert(questions).values(inserts);
    }
  }

  revalidatePath(`/organiser/olympiads/${portalId}`);
  redirect(`/organiser/olympiads/${portalId}`);
}
