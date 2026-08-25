import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { organiserApplications, portals, schools } from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { submitOrganiserApplication } from '../actions';
import CreatePortalSection from '@/components/organiser/CreatePortalSection';
import ApplicationForm from './ApplicationForm';
import Link from 'next/link';

export default async function OrganiserDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
        const timeSinceRejected =
          new Date().getTime() - application.updatedAt.getTime();
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
    const userPortals = await db
      .select()
      .from(portals)
      .where(eq(portals.ownerUserId, user.id));

    // Fetch schools for all user portals
    const portalIds = userPortals.map((p) => p.id);
    const portalSchools =
      portalIds.length > 0
        ? await db
            .select()
            .from(schools)
            .where(inArray(schools.portalId, portalIds))
        : [];

    const schoolsByPortal = new Map<string, typeof portalSchools>();
    for (const school of portalSchools) {
      const list = schoolsByPortal.get(school.portalId) ?? [];
      list.push(school);
      schoolsByPortal.set(school.portalId, list);
    }

    // We need metrics
    const activeOlympiads = userPortals.length;
    const totalParticipants = 0;
    const pendingApprovals = 0;

    return (
      <div
        style={{
          minHeight: '100vh',
          backgroundColor: '#F8FAFC',
          padding: '2rem 1rem',
        }}
      >
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          {/* Welcome Banner */}
          <div
            className="bg-[url('/images/banner.png')] bg-cover bg-center"
            style={{
              backgroundImage: "url('/images/banner.png')",
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              borderRadius: '1rem',
              padding: '3rem 2rem 5rem 2rem',
              display: 'flex',
              alignItems: 'center',
              gap: '1.5rem',
              marginBottom: '0',
            }}
          >
            {/* Placeholder Profile Picture */}
            <div
              className="border-4 border-white/20"
              style={{
                width: '80px',
                height: '80px',
                borderRadius: '50%',
                backgroundColor: '#FFFFFF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                border: '4px solid rgba(255, 255, 255, 0.2)',
              }}
            >
              <span style={{ fontSize: '2rem', color: '#0066CC' }}>
                {user.email?.charAt(0).toUpperCase()}
              </span>
            </div>
            <div>
              <h1
                className="text-white"
                style={{
                  fontSize: '2.5rem',
                  fontWeight: 'bold',
                  color: '#FFFFFF',
                  margin: 0,
                }}
              >
                Welcome back,{' '}
                {user.user_metadata?.full_name?.split(' ')[0] || 'Organiser'}
              </h1>
              <p
                className="text-slate-100"
                style={{
                  color: '#F1F5F9',
                  fontSize: '1.1rem',
                  marginTop: '0.5rem',
                }}
              >
                Here is what's happening with your Olympiads today.
              </p>
            </div>
          </div>

          {/* Action Area (Your Olympiads) */}
          <div
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: '0.75rem',
              padding: '2rem',
              border: '1px solid #E2E8F0',
              boxShadow: '0 1px 3px 0 rgba(0,0,0,0.1)',
              marginTop: '4rem',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                width: '100%',
                marginBottom: '1.5rem',
              }}
            >
              <h2
                style={{
                  fontSize: '1.5rem',
                  fontWeight: 'bold',
                  color: '#0F172A',
                  margin: 0,
                }}
              >
                Your Olympiads
              </h2>
              {userPortals.length > 0 && (
                <CreatePortalSection isEmpty={false} />
              )}
            </div>

            {userPortals.length === 0 ? (
              <CreatePortalSection isEmpty={true} />
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1rem',
                }}
              >
                {userPortals.map((p) => {
                  const portalSchoolList = schoolsByPortal.get(p.id) ?? [];
                  return (
                    <Link 
                      href={`/organiser/olympiads/${p.id}`} 
                      key={p.id}
                      style={{ textDecoration: 'none' }}
                    >
                      <div
                        className="hover:border-blue-300 hover:shadow-md transition-all duration-200 bg-white"
                        style={{
                          padding: '1.5rem',
                          border: '1px solid #E2E8F0',
                          borderRadius: '0.5rem',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          cursor: 'pointer', // Adds a pointer finger on hover
                        }}
                      >
                        <div>
                          <h3 style={{ fontSize: '1.25rem', fontWeight: '600', color: '#1E293B', margin: '0 0 0.25rem 0' }}>
                            {p.name}
                          </h3>
                          <span style={{ fontSize: '0.85rem', color: '#64748B' }}>
                            {portalSchoolList.length} Participating Schools
                          </span>
                        </div>
                        <span
                          style={{
                            fontSize: '0.75rem',
                            fontWeight: '600',
                            padding: '0.25rem 0.75rem',
                            borderRadius: '9999px',
                            background: p.status === 'approved' ? '#DCFCE7' : p.status === 'rejected' ? '#FEE2E2' : '#F1F5F9',
                            color: p.status === 'approved' ? '#166534' : p.status === 'rejected' ? '#991B1B' : '#475569',
                          }}
                        >
                          {p.status.toUpperCase()}
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Non-approved states (Application flow)
  const isPending = state === 'pending';
  const isRejected = state === 'rejected';

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#F8FAFC',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem 1rem',
      }}
    >
      <div
        style={{
          backgroundColor: '#FFFFFF',
          border: '1px solid #E2E8F0',
          borderRadius: '0.75rem',
          boxShadow:
            '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)',
          width: '100%',
          maxWidth: '550px',
          padding: '2.5rem',
        }}
      >
        {isPending ? (
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                marginBottom: '1.5rem',
              }}
            >
              <svg
                width="64"
                height="64"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#0066CC"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                <path d="M9 12l2 2 4-4"></path>
              </svg>
            </div>
            <h1
              style={{
                fontSize: '1.5rem',
                fontWeight: 'bold',
                color: '#1E293B',
                marginBottom: '1rem',
              }}
            >
              Application Submitted
            </h1>
            <p style={{ color: '#64748B', lineHeight: '1.6' }}>
              Awaiting Admin Verification. Your documents have been uploaded and
              are under review.
            </p>
          </div>
        ) : isRejected ? (
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                marginBottom: '1.5rem',
              }}
            >
              <svg
                width="64"
                height="64"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#EF4444"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="15" y1="9" x2="9" y2="15"></line>
                <line x1="9" y1="9" x2="15" y2="15"></line>
              </svg>
            </div>
            <h1
              style={{
                fontSize: '1.5rem',
                fontWeight: 'bold',
                color: '#EF4444',
                marginBottom: '1rem',
              }}
            >
              Application Denied
            </h1>
            <p style={{ color: '#64748B', lineHeight: '1.6' }}>
              Unfortunately, your application to become an organiser was denied.
              You cannot apply again until{' '}
              <strong>{nextApplyDate?.toLocaleDateString()}</strong>.
            </p>
          </div>
        ) : (
          <ApplicationForm
            submitAction={
              submitOrganiserApplication as (fd: FormData) => Promise<void>
            }
          />
        )}
      </div>
    </div>
  );
}
