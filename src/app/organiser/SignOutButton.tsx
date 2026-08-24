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
      style={{
        backgroundColor: 'transparent',
        border: '1px solid #0066CC',
        color: '#0066CC',
        padding: '0.5rem 1rem',
        borderRadius: '0.375rem',
        fontWeight: '500',
        cursor: 'pointer',
        transition: 'all 0.2s',
      }}
      onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#EFF6FF')}
      onMouseOut={(e) =>
        (e.currentTarget.style.backgroundColor = 'transparent')
      }
    >
      Sign Out
    </button>
  );
}
