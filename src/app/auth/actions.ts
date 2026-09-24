'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { users, memberships } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';

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

  // Credentials may still exist in Supabase Auth even though the account was
  // deleted from the app (e.g. its public.users row was removed via Table
  // Editor). Block these "ghost" accounts instead of letting them sign in and
  // land in the organiser portal.
  const {
    data: { user: authedUser },
  } = await supabase.auth.getUser();

  if (authedUser) {
    const [profile] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, authedUser.id));

    if (!profile) {
      await supabase.auth.signOut();
      return {
        error:
          'This account no longer exists. Please contact the administrator if you believe this is a mistake.',
      };
    }
  }

  // A user may create their account without ever clicking an invite link.
  // Accept any pending invites addressed to this email so they land in every
  // olympiad they were invited to (teachers commonly join several).
  if (authedUser?.email) {
    await db
      .update(memberships)
      .set({
        userId: authedUser.id,
        status: 'accepted',
        claimedAt: new Date(),
      })
      .where(
        and(
          eq(memberships.invitedEmail, authedUser.email.toLowerCase()),
          eq(memberships.status, 'invited')
        )
      );
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

        // Save school_id to user profile
        if (invite.schoolId) {
          await db
            .update(users)
            .set({ schoolId: invite.schoolId })
            .where(eq(users.id, userId));
        }

        // Determine redirect based on role (applied after try/catch)
        if (invite.role === 'educator') {
          redirectTo = `/educator?portalId=${invite.portalId}`;
        } else if (invite.role === 'student') {
          redirectTo = `/results?portalId=${invite.portalId}`;
        }
      }
    }

    // 4. Auto-accept this email's other pending invites too, so someone
    // invited to multiple olympiads before creating an account joins all
    // of them on first signup — not just the one whose link they clicked.
    await db
      .update(memberships)
      .set({
        userId: userId,
        status: 'accepted',
        claimedAt: new Date(),
      })
      .where(
        and(
          eq(memberships.invitedEmail, email.toLowerCase()),
          eq(memberships.status, 'invited')
        )
      );
  } catch (dbError: any) {
    console.error('Database insertion error:', dbError);
    return {
      error: `Account created, but database setup failed: ${dbError.message || dbError}`,
    };
  }

  // Redirect to the welcome page for new accounts, carrying the page they
  // were heading to — both fresh organiser signups and educators/students
  // claiming an invited account land there first.
  revalidatePath('/', 'layout');
  redirect(`/welcome?next=${encodeURIComponent(redirectTo ?? '/dashboard')}`);
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/');
}

// The reset email's link must lead back to a site we control. The request's
// Origin header is spoofable, so only trust it when it is the configured
// production URL, a local dev server, or a private LAN address (used when
// browsing the dev server from another device on the same network, e.g. a
// phone) — otherwise fall back to the configured base URL.
function resolveResetOrigin(originHeader: string | null): string {
  const configured = (
    process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
  ).replace(/\/+$/, '');

  if (originHeader) {
    const origin = originHeader.replace(/\/+$/, '');
    const isConfigured = origin === configured;
    const isLocalDev =
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    // RFC 1918 private ranges: 10.x.x.x, 172.16-31.x.x, 192.168.x.x
    const isPrivateNetwork =
      /^https?:\/\/(10(\.\d{1,3}){3}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}|192\.168(\.\d{1,3}){2})(:\d+)?$/.test(
        origin
      );
    if (isConfigured || isLocalDev || isPrivateNetwork) {
      return origin;
    }
  }

  return configured;
}

export async function requestPasswordReset(
  formData: FormData
): Promise<{ error?: string; success?: string }> {
  const supabase = await createClient();

  const email = (formData.get('email') as string).trim();
  if (!email) {
    return { error: 'Please enter the email address you signed up with.' };
  }

  // Ghost accounts (Supabase credentials whose app profile was deleted) are
  // blocked at sign-in, so don't send them a reset link either.
  const [profile] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`);

  if (profile) {
    const origin = resolveResetOrigin((await headers()).get('origin'));

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/callback?next=/reset-password`,
    });

    if (error) {
      console.error('Password reset request failed:', error.message);
      return {
        error:
          'Something went wrong while sending the reset email. Please try again in a moment.',
      };
    }
  }

  // Always report success — never reveal whether the address has an account.
  return {
    success:
      'If an account exists for that email, a password reset link is on its way. Please check your inbox (and your spam folder).',
  };
}

export async function resetPassword(formData: FormData) {
  const supabase = await createClient();

  const password = formData.get('password') as string;
  const confirmPassword = formData.get('confirmPassword') as string;

  if (!password || password.length < 6) {
    return { error: 'Passwords must be at least 6 characters long.' };
  }
  if (password !== confirmPassword) {
    return { error: 'Passwords do not match.' };
  }

  // The reset email links to /auth/callback, which exchanges the recovery
  // code for a session before redirecting here. No session means the page was
  // opened directly or the link has expired.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      error:
        'Your password reset link is invalid or has expired. Please request a new one.',
    };
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return { error: error.message };
  }

  // The recovery session is kept once the password changes, so the user is
  // already signed in — take them straight to their dashboard.
  revalidatePath('/', 'layout');
  redirect('/dashboard');
}
