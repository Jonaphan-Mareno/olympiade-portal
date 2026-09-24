'use server';

import { db } from '@/lib/db';
import { certificateTemplates } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export async function updateCertificateTemplates(
  roundId: string,
  templates: {
    minScorePercentage: string;
    templateUrl: string;
    nameXCoord: string;
    nameYCoord: string;
    nameFontSize: number;
    nameTextColor: string;
  }[]
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  // Clear existing templates for the round
  await db.delete(certificateTemplates).where(eq(certificateTemplates.roundId, roundId));

  if (templates.length > 0) {
    await db.insert(certificateTemplates).values(
      templates.map(t => ({
        roundId,
        minScorePercentage: t.minScorePercentage,
        templateUrl: t.templateUrl,
        nameXCoord: t.nameXCoord,
        nameYCoord: t.nameYCoord,
        nameFontSize: t.nameFontSize,
        nameTextColor: t.nameTextColor,
      }))
    );
  }

  revalidatePath(`/organiser/olympiads/[olympiadId]/rounds/${roundId}/certificate`, 'page');
  return { success: true };
}

export async function uploadCertificateTemplate(roundId: string, formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  const file = formData.get('file') as File;
  if (!file) throw new Error('No file provided');

  const fileExt = file.name.split('.').pop() || 'pdf';
  const fileName = `papers/${crypto.randomUUID()}.${fileExt}`;

  const { error } = await supabase.storage
    .from('round-documents')
    .upload(fileName, file, { contentType: file.type || 'application/pdf' });

  if (error) {
    throw new Error(error.message);
  }

  const { data: publicUrlData } = supabase.storage
    .from('round-documents')
    .getPublicUrl(fileName);

  return { publicUrl: publicUrlData.publicUrl };
}
