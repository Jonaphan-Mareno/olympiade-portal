import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

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
    <div className="container" style={{ paddingTop: '4rem' }}>
      {children}
    </div>
  );
}
