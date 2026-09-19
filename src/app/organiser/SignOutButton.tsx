'use client';

import { useRouter } from 'next/navigation';
import { logout } from '@/app/auth/actions';
import { PendingButton } from '@/components/ui/PendingButton';

export default function SignOutButton() {
  const router = useRouter();

  // PendingButton disables itself while this promise runs, so a double
  // click cannot fire the sign-out (and its redirect) twice.
  async function handleSignOut() {
    try {
      await logout();
    } catch {
      // logout uses redirect() which throws a navigation error we can ignore
    }
    router.push('/');
  }

  return (
    <PendingButton
      onClick={handleSignOut}
      pendingText="Signing Out…"
      className="bg-blue-900 hover:bg-blue-800 text-white font-semibold border-none px-4 py-2 rounded-md transition-colors disabled:bg-slate-500 disabled:cursor-not-allowed"
    >
      Sign Out
    </PendingButton>
  );
}
