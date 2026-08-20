'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { users, memberships } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function login(formData: FormData) {
  const supabase = await createClient();

  const email = (formData.get('email') as string).trim();
  const password = formData.get('password') as string;

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: error.message };
  }

  // Once logged in, go to the dashboard to select a portal
  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

export async function signup(formData: FormData) {
  const supabase = await createClient();

  const email = (formData.get('email') as string).trim();
  const password = formData.get('password') as string;
  const name = formData.get('name') as string;
  const inviteToken = formData.get('inviteToken') as string | null;

  // 1. Sign up the user in Supabase Auth
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: name,
      },
    },
  });

  if (authError) {
    return { error: authError.message };
  }

  const userId = authData.user?.id;
  if (!userId) {
    return { error: 'Failed to create user account.' };
  }

  try {
    // 2. Add the user to our public.users table via Drizzle
    const isPlatformAdmin = email === 'admin1@gmail.com';
    await db.insert(users).values({
      id: userId,
      email: email,
      name: name,
      isPlatformAdmin: isPlatformAdmin,
    }).onConflictDoNothing(); // Prevent error if a trigger already created them

    // 3. Handle Invite Token (Educator/Student Claiming Account)
    if (inviteToken) {
      // Find the membership by token
      const [invite] = await db.select().from(memberships).where(eq(memberships.inviteToken, inviteToken));
      
      if (invite) {
        // Claim it
        await db.update(memberships)
          .set({
            userId: userId,
            status: 'accepted',
            claimedAt: new Date(),
          })
          .where(eq(memberships.id, invite.id));
      }
    }

  } catch (dbError: any) {
    console.error('Database insertion error:', dbError);
    // Return the error to the UI so we can see why the insert failed
    return { error: `Account created, but database setup failed: ${dbError.message || dbError}` };
  }

  // Redirect to dashboard or a pending application page
  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}
