import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { logout } from '@/app/auth/actions';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    redirect('/login');
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
          <div className="glass-card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', color: 'var(--primary-color)' }}>Organiser View</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1rem' }}>
              Manage your Olympiads, create rounds, and view applications.
            </p>
            <button className="btn btn-secondary">Go to Organiser Portal</button>
          </div>

          <div className="glass-card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', color: 'var(--success-color)' }}>Educator View</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1rem' }}>
              Register students and upload offline results for your school.
            </p>
            <button className="btn btn-secondary">Go to Educator Portal</button>
          </div>
          
          <div className="glass-card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', color: 'var(--danger-color)' }}>Student View</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1rem' }}>
              Take online exams and view your results and certificates.
            </p>
            <button className="btn btn-secondary">Go to Student Portal</button>
          </div>
        </div>
      </div>
    </div>
  );
}
