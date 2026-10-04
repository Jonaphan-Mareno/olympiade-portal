import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  memberships,
  portals,
  remarkRequests,
  results,
  schools,
  submissions,
  users,
} from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function ManageRemarksPage({
  params,
}: {
  params: Promise<{ olympiadId: string; roundId: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { olympiadId, roundId } = await params;

  const [portal] = await db
    .select({ ownerUserId: portals.ownerUserId })
    .from(portals)
    .where(eq(portals.id, olympiadId));
  if (!portal || portal.ownerUserId !== user.id) redirect('/organiser/dashboard');

  const rows = await db
    .select({
      id: remarkRequests.id,
      status: remarkRequests.status,
      reason: remarkRequests.reason,
      previousScore: remarkRequests.previousScore,
      newScore: remarkRequests.newScore,
      responseNote: remarkRequests.responseNote,
      submissionType: submissions.submissionType,
      studentName: users.name,
      studentEmail: memberships.invitedEmail,
      schoolName: schools.name,
      currentScore: results.score,
    })
    .from(remarkRequests)
    .innerJoin(submissions, eq(submissions.id, remarkRequests.submissionId))
    .innerJoin(memberships, eq(memberships.id, submissions.studentMembershipId))
    .leftJoin(users, eq(users.id, memberships.userId))
    .leftJoin(schools, eq(schools.id, memberships.schoolId))
    .leftJoin(results, eq(results.submissionId, submissions.id))
    .where(and(eq(submissions.roundId, roundId)))
    .orderBy(desc(remarkRequests.createdAt));

  const pending = rows.filter((r) => r.status === 'pending');
  const resolved = rows.filter((r) => r.status === 'resolved');
  const base = `/organiser/olympiads/${olympiadId}/rounds/${roundId}`;

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4 md:px-8 text-slate-900">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <Link
            href={`/organiser/olympiads/${olympiadId}`}
            className="text-blue-600 hover:underline text-sm font-medium mb-4 inline-block"
          >
            &larr; Back to Olympiad
          </Link>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Remarks</h1>
          <p className="text-slate-600 text-lg mb-6">
            Entrants&apos; appeals for this round. Their school&apos;s educators
            re-mark them from the educator dashboard; you can review every
            outcome here and re-mark any pending appeal yourself.
          </p>
          <div className="flex gap-4 border-b border-slate-200">
            <Link href={base} className="pb-3 text-sm font-bold uppercase tracking-wider border-b-2 border-transparent text-slate-500 hover:text-slate-700">
              Manage Round
            </Link>
            <Link href={`${base}/certificate`} className="pb-3 text-sm font-bold uppercase tracking-wider border-b-2 border-transparent text-slate-500 hover:text-slate-700">
              Certificates
            </Link>
            <Link href={`${base}/remarks`} className="pb-3 text-sm font-bold uppercase tracking-wider border-b-2 border-slate-900 text-slate-900">
              Remarks
            </Link>
          </div>
        </div>

        <section className="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-slate-200 mb-8">
          <h2 className="text-xl font-bold mb-4">Pending ({pending.length})</h2>
          {pending.length === 0 ? (
            <p className="text-slate-500 italic text-center py-6">No pending appeals.</p>
          ) : (
            <div className="space-y-3">
              {pending.map((r) => (
                <Link
                  key={r.id}
                  href={`${base}/remarks/${r.id}`}
                  className="block border border-amber-200 bg-amber-50 rounded-lg p-4 hover:border-amber-400"
                >
                  <div className="flex justify-between gap-4">
                    <div>
                      <div className="font-bold">{r.studentName || r.studentEmail}</div>
                      <div className="text-sm text-slate-600">
                        {r.schoolName ?? 'No school'} · {r.submissionType === 'online' ? 'Online' : 'Paper'} · mark {r.currentScore ?? '—'}
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-blue-700 shrink-0">Review &rarr;</span>
                  </div>
                  <p className="text-sm text-slate-700 mt-2 line-clamp-2">{r.reason}</p>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-slate-200">
          <h2 className="text-xl font-bold mb-4">Resolved ({resolved.length})</h2>
          {resolved.length === 0 ? (
            <p className="text-slate-500 italic text-center py-6">No resolved appeals yet.</p>
          ) : (
            <div className="space-y-3">
              {resolved.map((r) => (
                <Link
                  key={r.id}
                  href={`${base}/remarks/${r.id}`}
                  className="block border border-green-200 bg-green-50 rounded-lg p-4 hover:border-green-400"
                >
                  <div className="flex justify-between gap-4">
                    <div>
                      <div className="font-bold">{r.studentName || r.studentEmail}</div>
                      <div className="text-sm text-slate-600">{r.schoolName ?? 'No school'}</div>
                    </div>
                    <div className="text-sm shrink-0">
                      {r.previousScore ?? '—'} → <strong>{r.newScore ?? '—'}</strong>
                    </div>
                  </div>
                  {r.responseNote && (
                    <p className="text-sm text-green-900 mt-2 line-clamp-2">{r.responseNote}</p>
                  )}
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
