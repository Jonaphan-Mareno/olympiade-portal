import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { db } from '@/lib/db';
import {
  memberships,
  remarkRequests,
  results,
  rounds,
  submissions,
  users,
} from '@/lib/db/schema';
import { and, desc, eq, inArray } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export default async function EducatorRemarksPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const educatorMemberships = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, user.id),
        eq(memberships.role, 'educator'),
        eq(memberships.status, 'accepted')
      )
    );
  if (educatorMemberships.length === 0) redirect('/dashboard');

  const cookieStore = await cookies();
  const activeSchoolId =
    cookieStore.get('active_school_id')?.value ?? educatorMemberships[0].schoolId;
  const portalIds = educatorMemberships
    .filter((m) => m.schoolId === activeSchoolId)
    .map((m) => m.portalId);

  if (!activeSchoolId || portalIds.length === 0) {
    return <div className="p-8 text-slate-600">No school assigned.</div>;
  }

  const rows = await db
    .select({
      id: remarkRequests.id,
      status: remarkRequests.status,
      reason: remarkRequests.reason,
      createdAt: remarkRequests.createdAt,
      previousScore: remarkRequests.previousScore,
      newScore: remarkRequests.newScore,
      roundName: rounds.name,
      submissionType: submissions.submissionType,
      studentName: users.name,
      studentEmail: memberships.invitedEmail,
      currentScore: results.score,
    })
    .from(remarkRequests)
    .innerJoin(submissions, eq(submissions.id, remarkRequests.submissionId))
    .innerJoin(rounds, eq(rounds.id, submissions.roundId))
    .innerJoin(memberships, eq(memberships.id, submissions.studentMembershipId))
    .leftJoin(users, eq(users.id, memberships.userId))
    .leftJoin(results, eq(results.submissionId, submissions.id))
    .where(
      and(
        eq(memberships.schoolId, activeSchoolId),
        inArray(rounds.portalId, portalIds)
      )
    )
    .orderBy(desc(remarkRequests.createdAt));

  const pending = rows.filter((r) => r.status === 'pending');
  const resolved = rows.filter((r) => r.status === 'resolved');

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-8 py-8 text-slate-900">
      <h1 className="text-3xl font-bold mb-2">Remark requests</h1>
      <p className="text-slate-600 mb-8">
        Entrants at your school who have appealed a mark. Re-mark the paper and
        the new mark flows straight into the standings.
      </p>

      <h2 className="text-lg font-bold mb-3">Awaiting remark ({pending.length})</h2>
      {pending.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-300 rounded-lg p-8 text-center text-slate-500 mb-10">
          No pending remark requests.
        </div>
      ) : (
        <div className="space-y-3 mb-10">
          {pending.map((r) => (
            <Link
              key={r.id}
              href={`/educator/remarks/${r.id}`}
              className="block bg-white border border-amber-300 rounded-lg p-4 hover:border-amber-500 transition-colors"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="font-bold">{r.studentName || r.studentEmail}</div>
                  <div className="text-sm text-slate-600">
                    {r.roundName} · {r.submissionType === 'online' ? 'Online' : 'Paper'} · current
                    mark {r.currentScore ?? '—'}
                  </div>
                </div>
                <span className="text-sm font-semibold text-blue-700">Remark &rarr;</span>
              </div>
              <p className="text-sm text-slate-700 mt-2 line-clamp-2">{r.reason}</p>
            </Link>
          ))}
        </div>
      )}

      <h2 className="text-lg font-bold mb-3">Resolved ({resolved.length})</h2>
      {resolved.length === 0 ? (
        <p className="text-slate-500 text-sm">None yet.</p>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
          {resolved.map((r) => (
            <Link
              key={r.id}
              href={`/educator/remarks/${r.id}`}
              className="flex justify-between gap-4 p-4 hover:bg-slate-50"
            >
              <span>
                <span className="font-semibold">{r.studentName || r.studentEmail}</span>
                <span className="text-sm text-slate-600"> · {r.roundName}</span>
              </span>
              <span className="text-sm text-slate-700">
                {r.previousScore ?? '—'} → <strong>{r.newScore ?? '—'}</strong>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
