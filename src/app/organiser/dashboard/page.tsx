import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { organiserApplications, portals } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { submitOrganiserApplication } from '../actions';

export default async function OrganiserDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const [application] = await db
    .select()
    .from(organiserApplications)
    .where(eq(organiserApplications.userId, user.id));

  // Determine State
  let state = 'no_application';
  let nextApplyDate: Date | null = null;
  
  if (application) {
    if (application.status === 'pending') {
      state = 'pending';
    } else if (application.status === 'approved') {
      state = 'approved';
    } else if (application.status === 'rejected') {
      // 6 month rule
      const sixMonths = 6 * 30 * 24 * 60 * 60 * 1000;
      if (application.updatedAt) {
        const timeSinceRejected = new Date().getTime() - application.updatedAt.getTime();
        if (timeSinceRejected < sixMonths) {
          state = 'rejected';
          nextApplyDate = new Date(application.updatedAt.getTime() + sixMonths);
        } else {
          state = 'no_application'; // Can apply again
        }
      } else {
        state = 'no_application';
      }
    }
  }

  // State 4: Approved - Show real organiser portal
  if (state === 'approved') {
    const userPortals = await db.select().from(portals).where(eq(portals.ownerUserId, user.id));
    
    return (
      <div className="glass-panel" style={{ padding: '2rem' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '1.5rem' }}>Organiser Portal</h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>
          Welcome! You are an approved organiser. Here you can manage your Olympiads.
        </p>
        
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Your Olympiads</h2>
        {userPortals.length === 0 ? (
          <p>You haven't created any Olympiads yet.</p>
        ) : (
          <ul>
            {userPortals.map(p => <li key={p.id}>{p.name} ({p.status})</li>)}
          </ul>
        )}
        <button className="btn btn-primary" style={{ marginTop: '1rem' }}>Create New Olympiad</button>
      </div>
    );
  }

  // State 2: Pending
  if (state === 'pending') {
    return (
      <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Application Under Review</h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          Your application to become an organiser is currently being reviewed by administrators. 
          Please check back later.
        </p>
      </div>
    );
  }

  // State 3: Rejected (Cooldown)
  if (state === 'rejected') {
    return (
      <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '1rem', color: 'var(--danger-color)' }}>Application Denied</h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          Unfortunately, your application to become an organiser was denied. 
          You cannot apply again until <strong>{nextApplyDate?.toLocaleDateString()}</strong>.
        </p>
      </div>
    );
  }

  // State 1: Temporary (No application or cooldown expired)
  return (
    <div className="glass-panel" style={{ padding: '2rem' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Organiser Application</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>
        To host Olympiads on our platform, you must first be approved by an administrator.
        Please submit your application below.
      </p>

      <form action={submitOrganiserApplication} className="auth-form-container" style={{ width: '100%', maxWidth: '600px', margin: '0 auto', boxShadow: 'none', background: 'transparent' }}>
        
        <div style={{ marginBottom: '2rem', padding: '1.5rem', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '0.75rem', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
          <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--primary-color)' }}>Application Requirements</h3>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Please upload a single PDF document that includes the following information:
          </p>
          <ul style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginLeft: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <li><strong>Your Background:</strong> A brief introduction about yourself or your organization.</li>
            <li><strong>Previous Experience:</strong> Details of any Olympiads or similar competitions you have previously organized.</li>
            <li><strong>Credibility:</strong> Why you are credible to organize this Olympiad and what resources you bring.</li>
            <li><strong>Olympiad Proposal:</strong> A brief overview of the Olympiad you intend to host on our platform.</li>
          </ul>
        </div>

        <div className="input-group" style={{ position: 'relative' }}>
          <input 
            type="file" 
            name="applicationPdf" 
            id="applicationPdf" 
            accept="application/pdf"
            required 
            style={{ 
              width: '100%', 
              padding: '1rem', 
              background: 'rgba(255, 255, 255, 0.05)', 
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '0.75rem',
              color: 'var(--text-primary)'
            }}
          />
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
            Please upload your application as a PDF document.
          </p>
        </div>

        <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }}>
          Submit Application
        </button>
      </form>
    </div>
  );
}
