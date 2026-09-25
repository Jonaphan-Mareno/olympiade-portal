'use server';

import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  rounds,
  questions,
  questionPapers,
  examSittings,
  portals,
} from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { deriveRoundState } from '@/domain/rounds/round-state-machine';
import {
  sendResultsPublishedNotifications,
  type DispatchSummary,
} from '@/domain/notifications/automation-engine';
import { notifyEducatorsInPortal } from '@/domain/notifications/in-app-notifications';
import type { Round } from '@/domain/rounds/round.types';

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
  const deliveryMethod = formData.get('deliveryMethod') as 'paper' | 'online' | 'hybrid';
  const durationMinutes = Math.max(1, parseInt((formData.get('durationMinutes') as string) || '60', 10));

  if (new Date(closesAt) <= new Date(opensAt)) {
    throw new Error('Closing time must be after the opening time.');
  }

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

  let paperRecord = await db
    .select()
    .from(questionPapers)
    .where(eq(questionPapers.roundId, roundId))
    .limit(1);

  // If paper/hybrid, handle PDF replacements
  if (deliveryMethod === 'paper' || deliveryMethod === 'hybrid') {
    const questionPaperFile = formData.get('questionPaper') as File | null;
    const answerKeyFile = formData.get('answerKey') as File | null;
    
    let fileUrl = paperRecord[0]?.fileUrl || null;
    let answerKeyJson = paperRecord[0]?.answerKeyJson || null;

    if (questionPaperFile && questionPaperFile.size > 0) {
      const fileExtension = questionPaperFile.name.split('.').pop() || 'pdf';
      const uniqueFileName = `papers/${crypto.randomUUID()}.${fileExtension}`;

      const { error: uploadError } = await supabase.storage
        .from('round-documents')
        .upload(uniqueFileName, questionPaperFile, { contentType: 'application/pdf' });

      if (!uploadError) {
        const { data } = supabase.storage.from('round-documents').getPublicUrl(uniqueFileName);
        fileUrl = data.publicUrl;
        
        // Notify educators that the paper is available
        await notifyEducatorsInPortal(
          portalId,
          'Question Paper Available',
          `The question paper for ${name} is now available for download.`,
          `/educator/olympiads/${portalId}/rounds/${roundId}`
        );
      }
    }

    if (answerKeyFile && answerKeyFile.size > 0) {
      const fileExtension = answerKeyFile.name.split('.').pop() || 'pdf';
      const uniqueFileName = `papers/${crypto.randomUUID()}.${fileExtension}`;

      const { error: uploadError } = await supabase.storage
        .from('round-documents')
        .upload(uniqueFileName, answerKeyFile, { contentType: 'application/pdf' });

      if (!uploadError) {
        const { data } = supabase.storage.from('round-documents').getPublicUrl(uniqueFileName);
        const currentAnswerKeyObj = (typeof answerKeyJson === 'object' && answerKeyJson !== null) ? answerKeyJson : {};
        answerKeyJson = { ...currentAnswerKeyObj, memoUrl: data.publicUrl };
      }
    }

    if (paperRecord.length === 0) {
      await db.insert(questionPapers).values({ roundId, durationMinutes, fileUrl, answerKeyJson, isMultipleChoice: false });
      paperRecord = await db.select().from(questionPapers).where(eq(questionPapers.roundId, roundId)).limit(1);
    } else {
      await db.update(questionPapers).set({ durationMinutes, fileUrl, answerKeyJson }).where(eq(questionPapers.id, paperRecord[0].id));
    }
  }

  if (deliveryMethod === 'online' || deliveryMethod === 'hybrid') {
    // Check if any student has started the exam
    let hasLiveSittings = false;
    if (paperRecord && paperRecord.length > 0) {
      const sittings = await db
        .select()
        .from(examSittings)
        .where(eq(examSittings.questionPaperId, paperRecord[0].id))
        .limit(1);
      hasLiveSittings = sittings.length > 0;
    }

    if (hasLiveSittings) {
      throw new Error(
        'This round cannot be edited because students have already begun their attempts.'
      );
    }

    if (paperRecord.length === 0) {
      await db.insert(questionPapers).values({ roundId, durationMinutes });
      paperRecord = await db.select().from(questionPapers).where(eq(questionPapers.roundId, roundId)).limit(1);
    } else if (deliveryMethod === 'online') {
      // Only update duration here if it was strictly online, since hybrid already did it above
      await db.update(questionPapers).set({ durationMinutes }).where(eq(questionPapers.id, paperRecord[0].id));
    }

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
            marks: Number(q.marks) || 1,
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

export async function deleteRound(roundId: string, portalId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const [round] = await db.select().from(rounds).where(eq(rounds.id, roundId));
  if (!round) throw new Error('Round not found');

  const roundState = deriveRoundState(round, new Date());
  if (roundState !== 'scheduled') {
    throw new Error('Cannot delete a round that has already opened or started.');
  }

  // We can rely on ON DELETE CASCADE in the database to remove questions, question_papers, submissions etc.
  await db.delete(rounds).where(eq(rounds.id, roundId));

  revalidatePath(`/organiser/olympiads/${portalId}`);
  redirect(`/organiser/olympiads/${portalId}`);
}

/**
 * Releases a round's results: stamps rounds.resultsPublished_at (moving the
 * round to its final 'released' state) and immediately emails every educator
 * a school-level summary and every entrant who submitted their own result.
 * Safe to call more than once — notification_log deduplicates per recipient.
 */
export async function publishRoundResults(
  formData: FormData
): Promise<{
  error?: string;
  alreadyPublished?: boolean;
  summary?: DispatchSummary;
}> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const portalId = formData.get('portalId') as string;
  const roundId = formData.get('roundId') as string;

  const [row] = await db
    .select({
      id: rounds.id,
      portalId: rounds.portalId,
      name: rounds.name,
      orderIndex: rounds.orderIndex,
      deliveryMethod: rounds.deliveryMethod,
      opensAt: rounds.opensAt,
      closesAt: rounds.closesAt,
      qualifyingThreshold: rounds.qualifyingThreshold,
      resultsPublishedAt: rounds.resultsPublishedAt,
      portalName: portals.name,
      portalOwnerId: portals.ownerUserId,
    })
    .from(rounds)
    .innerJoin(portals, eq(portals.id, rounds.portalId))
    .where(and(eq(rounds.id, roundId), eq(rounds.portalId, portalId)));

  // Only the portal owner may release results
  if (!row || row.portalOwnerId !== user.id) {
    throw new Error('Not authorized to publish results for this round');
  }

  if (row.resultsPublishedAt) {
    // Already released — re-send is a no-op thanks to notification_log
    revalidatePath(`/organiser/olympiads/${portalId}/rounds/${roundId}`);
    return { alreadyPublished: true };
  }

  // Results can only be released once the round has closed
  if (deriveRoundState(row) !== 'closed') {
    return {
      error: 'Results can only be published after the round has closed.',
    };
  }

  const publishedAt = new Date();
  await db
    .update(rounds)
    .set({ resultsPublishedAt: publishedAt })
    .where(eq(rounds.id, roundId));

  const round: Round = {
    id: row.id,
    portalId: row.portalId,
    portalName: row.portalName,
    name: row.name,
    orderIndex: row.orderIndex,
    deliveryMethod: row.deliveryMethod,
    opensAt: row.opensAt,
    closesAt: row.closesAt,
    qualifyingThreshold: row.qualifyingThreshold,
    resultsPublishedAt: publishedAt,
  };

  let summary: DispatchSummary;
  try {
    summary = await sendResultsPublishedNotifications(round);
  } catch (err) {
    console.error('Failed to send results-published notifications:', err);
    // The round is still released; the scheduler sweep will retry the emails.
    summary = { sent: 0, skipped: 0, failed: 0 };
  }

  revalidatePath(`/organiser/olympiads/${portalId}/rounds/${roundId}`);
  revalidatePath(`/organiser/olympiads/${portalId}`);

  return { summary };
}
