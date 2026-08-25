'use server';

import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { rounds, questionPapers } from '@/lib/db/schema';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

export async function createRound(formData: FormData) {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  // Extract Form Data
  const portalId = formData.get('portalId') as string;
  const name = formData.get('name') as string;
  const orderIndex = parseInt(formData.get('orderIndex') as string, 10);
  const opensAt = formData.get('opensAt') as string;
  const closesAt = formData.get('closesAt') as string;
  
  const questionPaperFile = formData.get('questionPaper') as File;
  const answerKeyFile = formData.get('answerKey') as File;

  // 1. Upload Question Paper PDF to Supabase Storage
  const fileExtension = questionPaperFile.name.split('.').pop();
  const uniqueFileName = `papers/${crypto.randomUUID()}.${fileExtension}`;
  
  const { error: uploadError } = await supabase.storage
    .from('round-documents')
    .upload(uniqueFileName, questionPaperFile, { contentType: 'application/pdf' });
    
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
  
  const { data: publicUrlData } = supabase.storage
    .from('round-documents')
    .getPublicUrl(uniqueFileName);

  // 2. Read and parse the Answer Key JSON file directly
  const answerKeyText = await answerKeyFile.text();
  const answerKeyJson = JSON.parse(answerKeyText);

  // 3. Insert the Round using your exact camelCase schema keys
  const [newRound] = await db.insert(rounds).values({
    portalId,
    name,
    orderIndex,
    opensAt: new Date(opensAt),
    closesAt: new Date(closesAt),
  }).returning({ id: rounds.id });

  // 4. Insert the Question Paper & Answer Key JSON
  if (newRound) {
    await db.insert(questionPapers).values({
      roundId: newRound.id,
      fileUrl: publicUrlData.publicUrl,
      answerKeyJson,
      isMultipleChoice: true, // You can make this dynamic later if needed
    });
  }

  revalidatePath(`/organiser/olympiads/${portalId}`);
  redirect(`/organiser/olympiads/${portalId}`);
}