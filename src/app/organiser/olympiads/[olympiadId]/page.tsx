import { db } from '@/lib/db';
import { portals, rounds } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export default async function OlympiadDetailsPage({
  params,
}: {
  params: Promise<{ olympiadId: string }>; 
}) {
  const resolvedParams = await params;
  const portalId = resolvedParams.olympiadId;

  const [portal] = await db
    .select()
    .from(portals)
    .where(eq(portals.id, portalId));

  if (!portal) {
    redirect('/organiser/dashboard');
  }

  // 2. Fetch all rounds associated with this Olympiad, ordered by their orderIndex
  const existingRounds = await db
    .select()
    .from(rounds)
    .where(eq(rounds.portalId, portalId))
    .orderBy(rounds.orderIndex);

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8FAFC', padding: '2rem 1rem' }}>
      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
        
        {/* Header Section */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <div>
            <Link href="/organiser/dashboard" style={{ color: '#64748B', textDecoration: 'none', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <span>&larr;</span> Back to Dashboard
            </Link>
            <h1 style={{ fontSize: '2rem', fontWeight: 'bold', color: '#0F172A', margin: 0 }}>
              {portal.name}
            </h1>
            <p style={{ color: '#64748B', marginTop: '0.25rem' }}>
              Manage your rounds, question banks, and automations here.
            </p>
          </div>
          
          <span style={{
            fontSize: '0.85rem', fontWeight: '600', padding: '0.5rem 1rem', borderRadius: '9999px',
            background: portal.status === 'approved' ? '#DCFCE7' : '#FEE2E2',
            color: portal.status === 'approved' ? '#166534' : '#991B1B',
          }}>
            {portal.status.toUpperCase()}
          </span>
        </div>

        {/* Rounds Management Section */}
        <div style={{ backgroundColor: '#FFFFFF', borderRadius: '0.75rem', padding: '2rem', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px 0 rgba(0,0,0,0.1)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#0F172A', margin: 0 }}>
              Competition Rounds
            </h2>
            
            {/* The crucial Create Round Button */}
            <Link 
              href={`/organiser/olympiads/${portalId}/rounds/create`}
              style={{
                backgroundColor: '#0066CC', color: '#FFFFFF', padding: '0.5rem 1rem', borderRadius: '0.5rem',
                textDecoration: 'none', fontSize: '0.9rem', fontWeight: '600', transition: 'background-color 0.2s'
              }}
            >
              + Create New Round
            </Link>
          </div>

          {/* List existing rounds or show empty state */}
          {existingRounds.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', backgroundColor: '#F8FAFC', borderRadius: '0.5rem', border: '1px dashed #CBD5E1' }}>
              <p style={{ color: '#64748B', marginBottom: '1rem' }}>No rounds have been created for this Olympiad yet.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {existingRounds.map((round) => (
                <div key={round.id} style={{ padding: '1.25rem', border: '1px solid #E2E8F0', borderRadius: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: '600', color: '#1E293B', margin: '0 0 0.25rem 0' }}>
                      Round {round.orderIndex}: {round.name}
                    </h3>
                    <p style={{ fontSize: '0.85rem', color: '#64748B', margin: 0 }}>
                      Opens: {round.opensAt.toLocaleString()} | Closes: {round.closesAt.toLocaleString()}
                    </p>
                  </div>
                  <Link href={`/organiser/olympiads/${portalId}/rounds/${round.id}`} style={{ color: '#0066CC', textDecoration: 'none', fontSize: '0.9rem', fontWeight: '500' }}>
                    Manage &rarr;
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}