import { db } from '@/lib/db';
import { organiserApplications, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { approveApplication, denyApplication } from '../actions';
import Link from 'next/link';

export default async function AdminDashboardPage() {
  const pendingApplications = await db
    .select({
      id: organiserApplications.id,
      pdfUrl: organiserApplications.pdfUrl,
      createdAt: organiserApplications.createdAt,
      userEmail: users.email,
      userName: users.name,
    })
    .from(organiserApplications)
    .innerJoin(users, eq(users.id, organiserApplications.userId))
    .where(eq(organiserApplications.status, 'pending'));

  return (
    <div className="glass-panel" style={{ padding: '2rem' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '1.5rem' }}>Admin Dashboard</h1>
      <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem', color: 'var(--primary-color)' }}>
        Pending Organiser Applications
      </h2>

      {pendingApplications.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)' }}>No pending applications.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {pendingApplications.map((app) => (
            <div key={app.id} className="glass-card" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ fontSize: '1.1rem', marginBottom: '0.25rem' }}>{app.userName}</h3>
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                    {app.userEmail}
                  </p>
                  
                  <Link
                    href={app.pdfUrl}
                    target="_blank"
                    className="btn btn-secondary"
                    style={{ display: 'inline-block', marginBottom: '1rem' }}
                  >
                    View Application PDF
                  </Link>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <form action={approveApplication}>
                    <input type="hidden" name="applicationId" value={app.id} />
                    <button type="submit" className="btn btn-primary" style={{ backgroundColor: 'var(--success-color)' }}>
                      Accept
                    </button>
                  </form>
                  <form action={denyApplication}>
                    <input type="hidden" name="applicationId" value={app.id} />
                    <button type="submit" className="btn btn-secondary" style={{ backgroundColor: 'var(--danger-color)', color: 'white' }}>
                      Deny
                    </button>
                  </form>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
