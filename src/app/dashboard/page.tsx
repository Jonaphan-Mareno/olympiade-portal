import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { logout } from '@/app/auth/actions';
import Link from 'next/link';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    redirect('/login');
  }

  const [dbUser] = await db.select().from(users).where(eq(users.id, user.id));
  const isAdmin = dbUser?.isPlatformAdmin === true;

  return (
    <div className="container" style={{ paddingTop: '4rem' }}>
      <div className="glass-panel" style={{ padding: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' }}>
          <div>
            <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Dashboard</h1>
            <p style={{ color: 'var(--text-secondary)' }}>
              Welcome back, {user.email}!
            </p>
          </div>
          <form action={logout}>
            <button className="btn btn-secondary" type="submit" style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}>
              Sign Out
            </button>
          </form>
        </div>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
          {isAdmin && (
            <div className="glass-card" style={{ padding: '1.5rem', border: '1px solid var(--primary-color)' }}>
              <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', color: 'var(--primary-color)' }}>Admin View</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1rem' }}>
                Review and approve or deny Organiser applications.
              </p>
              <Link href="/admin/dashboard" className="btn btn-primary" style={{ display: 'inline-block' }}>Go to Admin Portal</Link>
            </div>
          )}

          <div className="glass-card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', color: 'var(--primary-color)' }}>Organiser View</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1rem' }}>
              Manage your Olympiads, create rounds, and view applications.
            </p>
            <Link href="/organiser/dashboard" className="btn btn-secondary" style={{ display: 'inline-block' }}>Go to Organiser Portal</Link>
          </div>
        </div>
      </div>
    </div>
  );
}


