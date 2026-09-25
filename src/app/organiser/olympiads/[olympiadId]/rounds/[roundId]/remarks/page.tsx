import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { results, submissions, users, memberships } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import ResolveRemarkForm from './ResolveRemarkForm';

export const dynamic = 'force-dynamic';

export default async function ManageRemarksPage({
  params,
}: {
  params: Promise<{ olympiadId: string; roundId: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { olympiadId, roundId } = await params;

  // Fetch all remarks for this round
  const allRemarks = await db
    .select({
      result: results,
      submission: submissions,
      studentName: users.name,
      studentEmail: memberships.invitedEmail,
    })
    .from(results)
    .innerJoin(submissions, eq(results.submissionId, submissions.id))
    .innerJoin(memberships, eq(submissions.studentMembershipId, memberships.id))
    .leftJoin(users, eq(memberships.userId, users.id))
    .where(
      and(
        eq(submissions.roundId, roundId),
        // Filter by remark status in code or here
      )
    );

  const remarkRequests = allRemarks.filter(r => r.result.status === 'remark_requested' || r.result.status === 'remark_resolved');
  
  const pendingRequests = remarkRequests.filter(r => r.result.status === 'remark_requested');
  const resolvedRequests = remarkRequests.filter(r => r.result.status === 'remark_resolved');

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4 md:px-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <Link
            href={`/organiser/olympiads/${olympiadId}`}
            className="text-blue-600 hover:underline text-sm font-medium mb-4 inline-block"
          >
            &larr; Back to Olympiad
          </Link>
          <div className="flex items-center justify-between gap-3 mb-2">
            <h1 className="text-3xl font-bold text-slate-900 m-0">
              Manage Remarks
            </h1>
          </div>
          <p className="text-slate-600 text-lg mb-6">
            Review and resolve remark requests from educators.
          </p>
          <div className="flex gap-4 border-b border-slate-200">
            <Link href={`/organiser/olympiads/${olympiadId}/rounds/${roundId}`} className="pb-3 text-sm font-bold uppercase tracking-wider border-b-2 border-transparent text-slate-500 hover:text-slate-700">
              Manage Round
            </Link>
            <Link href={`/organiser/olympiads/${olympiadId}/rounds/${roundId}/certificate`} className="pb-3 text-sm font-bold uppercase tracking-wider border-b-2 border-transparent text-slate-500 hover:text-slate-700">
              Certificates
            </Link>
            <Link href={`/organiser/olympiads/${olympiadId}/rounds/${roundId}/remarks`} className="pb-3 text-sm font-bold uppercase tracking-wider border-b-2 border-slate-900 text-slate-900">
              Remarks
            </Link>
          </div>
        </div>

        <div className="space-y-8">
          <div className="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-slate-200">
            <h2 className="text-xl font-bold text-slate-900 mb-6 border-b border-slate-100 pb-3 flex items-center justify-between">
              Pending Remarks ({pendingRequests.length})
            </h2>
            
            {pendingRequests.length === 0 ? (
              <p className="text-slate-500 italic text-center py-8">No pending remark requests.</p>
            ) : (
              <div className="space-y-6">
                {pendingRequests.map(req => (
                  <div key={req.result.id} className="border border-amber-200 bg-amber-50 rounded-lg p-5">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="font-bold text-slate-900">{req.studentName || req.studentEmail}</h3>
                        <p className="text-sm text-slate-600">Current Score: {req.result.score}</p>
                      </div>
                      <Link 
                        href={`/organiser/olympiads/${olympiadId}/rounds/${roundId}/marking?submissionId=${req.submission.id}`}
                        className="text-sm font-medium text-blue-600 hover:underline bg-white px-3 py-1.5 border border-blue-200 rounded-md"
                        target="_blank"
                      >
                        Review Submission
                      </Link>
                    </div>
                    
                    <div className="bg-white p-4 rounded border border-amber-100 mb-4">
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Educator's Reason</h4>
                      <p className="text-slate-800 text-sm">{req.result.remarkReason}</p>
                    </div>
                    
                    <ResolveRemarkForm resultId={req.result.id} />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-slate-200">
            <h2 className="text-xl font-bold text-slate-900 mb-6 border-b border-slate-100 pb-3">
              Resolved Remarks ({resolvedRequests.length})
            </h2>
            
            {resolvedRequests.length === 0 ? (
              <p className="text-slate-500 italic text-center py-8">No resolved remark requests yet.</p>
            ) : (
              <div className="space-y-4">
                {resolvedRequests.map(req => (
                  <div key={req.result.id} className="border border-green-200 bg-green-50 rounded-lg p-5 flex flex-col md:flex-row gap-6">
                    <div className="flex-1">
                      <h3 className="font-bold text-slate-900 mb-1">{req.studentName || req.studentEmail}</h3>
                      <p className="text-sm text-slate-600 mb-3">Score: {req.result.score}</p>
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Reason</h4>
                      <p className="text-slate-800 text-sm">{req.result.remarkReason}</p>
                    </div>
                    <div className="flex-1 bg-white p-4 rounded border border-green-100">
                      <h4 className="text-xs font-bold text-green-700 uppercase tracking-wider mb-1">Resolution Outcome</h4>
                      <p className="text-green-900 text-sm font-medium">{req.result.remarkOutcome}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
