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
  const deliveryMethod = formData.get('deliveryMethod') as 'paper' | 'online';

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
    const paper = await db
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
