import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { memberships, submissions, results, rounds, questions, studentAnswers, remarkRequests } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import Link from 'next/link';
import RemarkPanel from './RemarkPanel';

export const dynamic = 'force-dynamic';

function displayAnswer(value: string | undefined) {
  if (!value) return 'No answer';
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.join(', ') : typeof parsed === 'object' ? Object.entries(parsed).map(([a,b]) => `${a}: ${b}`).join(' · ') : String(parsed); } catch { return value; }
}

export default async function StudentRoundResult({ params }: { params: Promise<{ portalId: string; roundId: string }> }) {
  const { portalId, roundId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const [membership] = await db.select().from(memberships).where(and(eq(memberships.userId, user.id), eq(memberships.portalId, portalId), eq(memberships.role, 'student'))).limit(1);
  if (!membership) redirect('/results');
  const [round] = await db.select().from(rounds).where(and(eq(rounds.id, roundId), eq(rounds.portalId, portalId))).limit(1);
  if (!round) redirect(`/results/${portalId}`);
  const [submissionRow] = await db.select({ submission: submissions, result: results }).from(submissions).innerJoin(results, eq(results.submissionId, submissions.id)).where(and(eq(submissions.roundId, roundId), eq(submissions.studentMembershipId, membership.id))).orderBy(submissions.submittedAt).limit(1);
  if (!submissionRow) return <div className="p-8">No result is available for this round yet.</div>;
  const qs = await db.select().from(questions).where(eq(questions.roundId, roundId));
  const stored = (submissionRow.submission.answersJson || {}) as Record<string, any>;
  const sittingId = String(stored.__sittingId || '');
  const answers = sittingId ? await db.select().from(studentAnswers).where(eq(studentAnswers.sittingId, sittingId)) : [];
  const answerMap = new Map(answers.filter(a => a.questionId).map(a => [a.questionId!, a]));
  const [remark] = await db.select().from(remarkRequests).where(eq(remarkRequests.resultId, submissionRow.result.id)).limit(1);
  const maxMarks = qs.reduce((sum,q) => sum + q.marks, 0);
  const manualPending = submissionRow.result.status === 'queued_for_marker';
  return <div className="min-h-screen bg-slate-50 py-8 px-4"><div className="max-w-4xl mx-auto"><Link href={`/results/${portalId}`} className="text-blue-700 text-sm font-semibold">&larr; Back to rounds</Link><div className="mt-5 bg-white rounded-xl border border-slate-200 p-6 shadow-sm"><div className="flex justify-between gap-4"><div><p className="text-xs font-bold text-blue-700 uppercase">Result</p><h1 className="text-3xl font-bold text-slate-900">{round.name}</h1><p className="text-slate-500 mt-1">Submitted {submissionRow.submission.submittedAt ? new Date(submissionRow.submission.submittedAt).toLocaleString() : '—'}</p></div><div className="text-right"><div className="text-3xl font-bold text-slate-900">{manualPending ? `${submissionRow.result.score ?? 0} / ${maxMarks}` : `${submissionRow.result.score ?? 0} / ${maxMarks}`}</div><span className={`inline-block mt-2 px-3 py-1 rounded-full text-xs font-bold ${submissionRow.result.status === 'moderated' ? 'bg-green-100 text-green-700' : submissionRow.result.status === 'remark_requested' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>{submissionRow.result.status === 'moderated' ? 'Reviewed / moderated' : submissionRow.result.status === 'remark_requested' ? 'Remark requested' : manualPending ? 'Awaiting marking' : 'Automatically marked'}</span></div></div>{manualPending && <div className="mt-5 bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-900">Your non-MCQ answers have been sent to a marker. Your displayed score currently includes the automatically marked questions only.</div>}</div><div className="mt-6 space-y-4">{qs.map((q,i) => { const a=answerMap.get(q.id); const auto=['single_choice','multiple_choice','true_false'].includes(q.questionType); return <div key={q.id} className="bg-white border border-slate-200 rounded-xl p-5"><div className="flex justify-between gap-4"><h2 className="font-bold text-slate-900">Question {i+1}</h2><span className="text-sm text-slate-500">{auto ? `${a?.manualScore ?? (a ? 'auto' : '0')} / ${q.marks}` : a?.manualScore != null ? `${a.manualScore} / ${q.marks}` : manualPending ? `Pending / ${q.marks}` : `— / ${q.marks}`}</span></div><p className="mt-2 text-slate-800 whitespace-pre-wrap">{q.prompt}</p><div className="mt-4 bg-slate-50 rounded-md p-4"><p className="text-xs font-bold text-slate-500 uppercase">Your answer</p><p className="mt-1 text-slate-800 whitespace-pre-wrap">{displayAnswer(a?.answerValue)}</p></div>{a?.educatorFeedback && <div className="mt-3 text-sm text-slate-700"><strong>Marker feedback:</strong> {a.educatorFeedback}</div>}</div>; })}</div><RemarkPanel resultId={submissionRow.result.id} initialStatus={submissionRow.result.status} /></div></div>;
}
