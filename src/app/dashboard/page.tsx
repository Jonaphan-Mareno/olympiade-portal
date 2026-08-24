import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { logout } from '@/app/auth/actions';
import Link from 'next/link';
import { db } from '@/lib/db';
import { users, memberships, organiserApplications } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    redirect('/login');
  }

  const [dbUser] = await db.select().from(users).where(eq(users.id, user.id));
  const isAdmin = dbUser?.isPlatformAdmin === true;

  if (isAdmin) {
    redirect('/admin/dashboard');
  }

  // Check if user has educator memberships
  const educatorMemberships = await db
    .select()
    .from(memberships)
    .where(and(
      eq(memberships.userId, user.id),
      eq(memberships.role, 'educator'),
    ));
  const isEducator = educatorMemberships.length > 0;

  // Check if user has student memberships
  const studentMemberships = await db
    .select()
    .from(memberships)
    .where(and(
      eq(memberships.userId, user.id),
      eq(memberships.role, 'student'),
    ));
  const isStudent = studentMemberships.length > 0;

  // Check if user is an unverified organiser
  const [application] = await db
    .select()
    .from(organiserApplications)
    .where(eq(organiserApplications.userId, user.id));
  
  const hasOtherRoles = isAdmin || isEducator || isStudent;
  
  if (!hasOtherRoles) {
    redirect('/organiser/dashboard');
  }

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

          {isEducator && (
            <div className="glass-card" style={{ padding: '1.5rem', border: '1px solid var(--success-color)' }}>
              <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', color: 'var(--success-color)' }}>Educator View</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1rem' }}>
                Manage your classes, view submissions, and track student progress.
              </p>
              <Link href="/educator/dashboard" className="btn btn-primary" style={{ display: 'inline-block' }}>Go to Educator Portal</Link>
            </div>
          )}

          {isStudent && (
            <div className="glass-card" style={{ padding: '1.5rem' }}>
              <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Student View</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1rem' }}>
                View your results, submissions, and upcoming rounds.
              </p>
              <Link href="/results" className="btn btn-secondary" style={{ display: 'inline-block' }}>Go to Results</Link>
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


