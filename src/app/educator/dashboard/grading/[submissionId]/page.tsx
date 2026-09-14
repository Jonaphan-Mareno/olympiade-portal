import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { memberships, submissions, results, rounds, questions, studentAnswers, users, remarkRequests } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { saveMarks } from './actions';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function GradeSubmissionPage({ params }: { params: Promise<{ submissionId: string }> }) {
  const { submissionId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [row] = await db.select({ submission: submissions, result: results, round: rounds, membership: memberships })
    .from(submissions)
    .innerJoin(results, eq(results.submissionId, submissions.id))
    .innerJoin(rounds, eq(rounds.id, submissions.roundId))
    .innerJoin(memberships, and(eq(memberships.userId, user.id), eq(memberships.portalId, rounds.portalId), eq(memberships.role, 'educator')))
    .where(eq(submissions.id, submissionId)).limit(1);
  if (!row) return <div className="p-8">Submission not found.</div>;

  if (!row.submission.studentMembershipId) return <div className="p-8">Student information is missing.</div>;
  const [studentMembership] = await db.select().from(memberships).where(eq(memberships.id, row.submission.studentMembershipId)).limit(1);
  const [student] = studentMembership?.userId ? await db.select().from(users).where(eq(users.id, studentMembership.userId)).limit(1) : [];
  const qs = await db.select().from(questions).where(eq(questions.roundId, row.round.id));
  const stored = (row.submission.answersJson || {}) as Record<string, any>;
  const sittingId = String(stored.__sittingId || '');
  const answers = sittingId ? await db.select().from(studentAnswers).where(eq(studentAnswers.sittingId, sittingId)) : [];
  const answerMap = new Map<string, string>();
  answers.forEach(a => { if (a.questionId) answerMap.set(a.questionId, a.answerValue); });
  Object.entries(stored).filter(([k]) => k !== '__sittingId').forEach(([k,v]) => { if (!answerMap.has(k)) answerMap.set(k, typeof v === 'string' ? v : JSON.stringify(v)); });
  const [remark] = await db.select().from(remarkRequests).where(eq(remarkRequests.resultId, row.result.id)).limit(1);
  const manualQuestions = qs.filter(q => !['single_choice','multiple_choice','true_false'].includes(q.questionType));
  const autoQuestions = qs.filter(q => ['single_choice','multiple_choice','true_false'].includes(q.questionType));
  const maxMarks = qs.reduce((sum,q) => sum + q.marks, 0);

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-5xl mx-auto">
        <Link href="/educator/dashboard/grading" className="text-blue-700 text-sm font-semibold">&larr; Back to grading</Link>
        <div className="mt-5 bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <div className="flex flex-col md:flex-row md:justify-between gap-4">
            <div><p className="text-xs font-bold text-blue-700 uppercase">{row.round.name}</p><h1 className="text-3xl font-bold text-slate-900">{student?.name || 'Student'}</h1><p className="text-slate-500 mt-1">Submitted {row.submission.submittedAt ? new Date(row.submission.submittedAt).toLocaleString() : '—'}</p></div>
            <div className="text-right"><div className="text-2xl font-bold text-slate-900">{row.result.score ?? '—'} / {maxMarks}</div><span className="text-xs font-semibold text-slate-500 uppercase">{row.result.status.replaceAll('_',' ')}</span></div>
          </div>
        </div>
        {remark?.status === 'pending' && <div className="mt-5 bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-900"><strong>Remark requested.</strong><p className="mt-1 whitespace-pre-wrap">{remark.reason}</p></div>}

        <form action={saveMarks} className="mt-6 space-y-5">
          <input type="hidden" name="submissionId" value={submissionId} />
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className="text-xl font-bold text-slate-900">Auto-marked questions</h2>
            <p className="text-sm text-slate-500 mt-1">Multiple choice and true/false questions are marked automatically.</p>
            <div className="mt-5 space-y-4">
              {autoQuestions.map(q => <div key={q.id} className="border border-slate-200 rounded-lg p-4"><div className="flex justify-between gap-4"><p className="font-semibold text-slate-900">Question {qs.indexOf(q)+1}. {q.prompt}</p><span className="text-sm font-semibold text-slate-600">{answerMap.get(q.id) || 'No answer'}</span></div><p className="text-xs text-slate-500 mt-2">Correct: {Array.isArray(q.correctAnswer) ? q.correctAnswer.join(', ') : String(q.correctAnswer)} · {q.marks} mark{q.marks === 1 ? '' : 's'}</p></div>)}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className="text-xl font-bold text-slate-900">Manual marking</h2>
            <p className="text-sm text-slate-500 mt-1">Award any score from 0 up to the maximum. Partial credit is allowed.</p>
            <div className="mt-5 space-y-6">
              {manualQuestions.map(q => { const existing = answers.find(a => a.questionId === q.id); return <div key={q.id} className="border border-slate-200 rounded-lg p-5"><div className="flex justify-between gap-4"><div><p className="font-semibold text-slate-900">Question {qs.indexOf(q)+1}</p><p className="mt-1 text-slate-800 whitespace-pre-wrap">{q.prompt}</p></div><span className="text-sm font-semibold text-slate-500">/{q.marks}</span></div><div className="mt-4 bg-slate-50 rounded-md p-4"><p className="text-xs font-bold text-slate-500 uppercase">Student answer</p><p className="mt-2 text-slate-800 whitespace-pre-wrap">{answerMap.get(q.id) || 'No answer'}</p></div><div className="mt-4 grid md:grid-cols-[160px_1fr] gap-4"><div><label className="block text-sm font-semibold text-slate-700">Score</label><input required type="number" min="0" max={q.marks} step="0.01" name={`score_${q.id}`} defaultValue={existing?.manualScore ?? ''} className="mt-1 w-full p-2 border border-slate-300 rounded-md" /></div><div><label className="block text-sm font-semibold text-slate-700">Feedback (optional)</label><textarea name={`feedback_${q.id}`} defaultValue={existing?.educatorFeedback ?? ''} rows={2} className="mt-1 w-full p-2 border border-slate-300 rounded-md" placeholder="Explain the awarded marks…" /></div></div></div>; })}
              {!manualQuestions.length && <p className="text-slate-500">There are no manually marked questions.</p>}
            </div>
          </div>
          <div className="flex justify-end"><button type="submit" className="bg-blue-700 hover:bg-blue-800 text-white font-semibold px-6 py-3 rounded-lg">Save marks &amp; mark as reviewed</button></div>
        </form>
      </div>
    </div>
  );
}
