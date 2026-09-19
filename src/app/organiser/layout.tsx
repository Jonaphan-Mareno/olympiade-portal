import { ReactNode } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import SignOutButton from './SignOutButton';

export default function OrganiserLayout({ children }: { children: ReactNode }) {
  return (
    <div
      style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}
    >
      <header
        style={{
          backgroundColor: '#FFFFFF',
          borderBottom: '1px solid #E2E8F0',
          padding: '1rem 2rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          position: 'sticky',
          top: 0,
          zIndex: 50,
        }}
      >
        <Link
          href="/dashboard"
          style={{
            textDecoration: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <Image
            src="/images/logo-BIG-v2.jpg"
            alt="Olympia Logo"
            width={32}
            height={32}
            style={{ objectFit: 'contain' }}
          />
          <span
            style={{
              color: '#0066CC',
              fontWeight: 'bold',
              fontSize: '1.25rem',
            }}
          >
            Olympia
          </span>
        </Link>

        <SignOutButton />
      </header>
      <main style={{ flex: 1 }}>{children}</main>
    </div>
  );
}
