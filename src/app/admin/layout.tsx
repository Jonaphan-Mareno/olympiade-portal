import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import Link from 'next/link';
import Image from 'next/image';
import SignOutButton from '@/app/organiser/SignOutButton';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    redirect('/login');
  }

  // Verify platform admin
  const [dbUser] = await db.select().from(users).where(eq(users.id, user.id));

  if (!dbUser || !dbUser.isPlatformAdmin) {
    redirect('/dashboard');
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ 
        backgroundColor: '#FFFFFF', 
        borderBottom: '1px solid #E2E8F0', 
        padding: '1rem 2rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        position: 'sticky',
        top: 0,
        zIndex: 50
      }}>
        <Link href="/admin/dashboard" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Image src="/images/logo-BIG-v2.jpg" alt="Olympia Logo" width={32} height={32} style={{ objectFit: 'contain' }} />
          <span style={{ color: '#0066CC', fontWeight: 'bold', fontSize: '1.25rem' }}>Olympia</span>
        </Link>
        
        <SignOutButton />
      </header>
      <main style={{ flex: 1 }}>
        {children}
      </main>
    </div>
  );
}
