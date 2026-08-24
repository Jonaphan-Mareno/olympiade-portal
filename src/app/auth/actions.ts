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

  // Development bypass for admin testing
  if (email === 'admin1@gmail.com' && password === '111111') {
    const { error: loginError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (loginError) {
      // User doesn't exist or wrong state, try creating them
      const { data: authData, error: signUpError } = await supabase.auth.signUp(
        {
          email,
          password,
          options: { data: { full_name: 'Platform Admin' } },
        }
      );

      if (!signUpError && authData.user?.id) {
        await db
          .insert(users)
          .values({
            id: authData.user.id,
            email: email,
            name: 'Platform Admin',
            isPlatformAdmin: true,
          })
          .onConflictDoNothing();

        // Ensure they are signed in (in case signUp didn't auto sign in)
        await supabase.auth.signInWithPassword({ email, password });
      } else {
        return {
          error:
            'Admin bypass failed to create account: ' + signUpError?.message,
        };
      }
    }
  } else {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      return { error: error.message };
    }
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

  // Track where to redirect after the try/catch (redirect() throws, which would be caught)
  let redirectTo: string | null = null;

  try {
    // 2. Add the user to our public.users table via Drizzle
    const isPlatformAdmin = email === 'admin1@gmail.com';
    await db
      .insert(users)
      .values({
        id: userId,
        email: email,
        name: name,
        isPlatformAdmin: isPlatformAdmin,
      })
      .onConflictDoNothing(); // Prevent error if a trigger already created them

    // 3. Handle Invite Token (Educator/Student Claiming Account)
    if (inviteToken) {
      // Find the membership by token
      const [invite] = await db
        .select()
        .from(memberships)
        .where(eq(memberships.inviteToken, inviteToken));

      if (invite) {
        // Claim it
        await db
          .update(memberships)
          .set({
            userId: userId,
            status: 'accepted',
            claimedAt: new Date(),
          })
          .where(eq(memberships.id, invite.id));

        // Determine redirect based on role (applied after try/catch)
        if (invite.role === 'educator') {
          redirectTo = `/educator/dashboard?portalId=${invite.portalId}`;
        } else if (invite.role === 'student') {
          redirectTo = `/results?portalId=${invite.portalId}`;
        }
      }
    }
  } catch (dbError: any) {
    console.error('Database insertion error:', dbError);
    return {
      error: `Account created, but database setup failed: ${dbError.message || dbError}`,
    };
  }

  // Redirect to the appropriate page
  revalidatePath('/', 'layout');
  redirect(redirectTo ?? '/dashboard');
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/');
}
