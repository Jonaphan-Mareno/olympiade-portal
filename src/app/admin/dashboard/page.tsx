import { db } from '@/lib/db';
import { organiserApplications, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { approveApplication, denyApplication } from '../actions';
import { SubmitButton } from '@/components/SubmitButton';
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
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#F8FAFC',
        padding: '3rem 1rem',
      }}
    >
      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
        <h1
          style={{
            fontSize: '2.25rem',
            fontWeight: 'bold',
            color: '#0F172A',
            marginBottom: '0.5rem',
          }}
        >
          Admin Dashboard
        </h1>
        <h2
          style={{
            fontSize: '1.25rem',
            fontWeight: '600',
            color: '#334155',
            marginBottom: '2rem',
          }}
        >
          Pending Organiser Applications
        </h2>

        {pendingApplications.length === 0 ? (
          <div
            style={{
              backgroundColor: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: '0.75rem',
              padding: '3rem',
              textAlign: 'center',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
            }}
          >
            <p style={{ color: '#64748B', fontSize: '1rem' }}>
              No pending applications.
            </p>
          </div>
        ) : (
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
          >
            {pendingApplications.map((app) => (
              <div
                key={app.id}
                style={{
                  backgroundColor: '#FFFFFF',
                  border: '1px solid #E2E8F0',
                  borderRadius: '0.75rem',
                  padding: '1.5rem',
                  boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <h3
                    style={{
                      fontSize: '1.1rem',
                      fontWeight: '600',
                      color: '#1E293B',
                      marginBottom: '0.25rem',
                    }}
                  >
                    {app.userName}
                  </h3>
                  <p
                    style={{
                      fontSize: '0.9rem',
                      color: '#64748B',
                      marginBottom: '0.75rem',
                    }}
                  >
                    {app.userEmail}
                  </p>

                  <Link
                    href={app.pdfUrl}
                    target="_blank"
                    style={{
                      display: 'inline-block',
                      fontSize: '0.875rem',
                      color: '#0066CC',
                      fontWeight: '500',
                      textDecoration: 'none',
                      border: '1px solid #0066CC',
                      borderRadius: '0.375rem',
                      padding: '0.375rem 0.75rem',
                      transition: 'all 0.2s',
                    }}
                  >
                    View Application PDF
                  </Link>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <form action={approveApplication}>
                    <input type="hidden" name="applicationId" value={app.id} />
                    <SubmitButton
                      pendingText="Accepting…"
                      fullWidth={false}
                      className="disabled:opacity-60 disabled:cursor-not-allowed"
                      style={{
                        backgroundColor: '#0066CC',
                        color: '#FFFFFF',
                        border: 'none',
                        borderRadius: '0.375rem',
                        padding: '0.5rem 1rem',
                        fontSize: '0.875rem',
                        fontWeight: '500',
                        cursor: 'pointer',
                      }}
                    >
                      Accept
                    </SubmitButton>
                  </form>
                  <form action={denyApplication}>
                    <input type="hidden" name="applicationId" value={app.id} />
                    <SubmitButton
                      pendingText="Denying…"
                      fullWidth={false}
                      className="disabled:opacity-60 disabled:cursor-not-allowed"
                      style={{
                        backgroundColor: 'transparent',
                        color: '#EF4444',
                        border: '1px solid #EF4444',
                        borderRadius: '0.375rem',
                        padding: '0.5rem 1rem',
                        fontSize: '0.875rem',
                        fontWeight: '500',
                        cursor: 'pointer',
                      }}
                    >
                      Deny
                    </SubmitButton>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
