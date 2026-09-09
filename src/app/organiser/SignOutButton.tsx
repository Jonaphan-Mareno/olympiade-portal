'use client';

import { useRouter } from 'next/navigation';
import { logout } from '@/app/auth/actions';

export default function SignOutButton() {
  const router = useRouter();

  const handleSignOut = async () => {
    try {
      await logout();
    } catch (error) {
      // logout uses redirect() which throws an error we might want to catch or just ignore
    }
    router.push('/');
  };

  return (
    <button
      onClick={handleSignOut}
      className="bg-amber-500 hover:bg-amber-600 text-white font-semibold border-none px-4 py-2 rounded-md transition-colors"
    >
      Sign Out
    </button>
  );
}
