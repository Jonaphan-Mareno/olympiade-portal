import { db } from '@/lib/db';
import { memberships, schools, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  canResolveRemark,
  getQuestionMarks,
  getRemarkRequest,
} from '@/domain/remarks/remarks';
import RemarkResolver from './RemarkResolver';

function formatDate(date: Date): string {
  return (
    date.toLocaleString('en-GB', {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }) + ' UTC'
  );
}

/**
 * One remark request: the appeal, the paper and either the re-marking form
 * (pending) or the outcome (resolved). Used by the educator and organiser
 * dashboards; access is checked here.
 */
export default async function RemarkReview({
  requestId,
  userId,
  doneHref,
}: {
  requestId: string;
  userId: string;
  doneHref: string;
}) {
  const request = await getRemarkRequest(requestId);
  if (!request || !(await canResolveRemark(userId, request))) {
    return (
      <div className="bg-white p-8 border border-slate-200 rounded-lg text-center text-slate-600">
        This remark request doesn&apos;t exist or you don&apos;t have access to it.
      </div>
    );
  }

  const [student] = request.studentMembershipId
    ? await db
        .select({
          name: users.name,
          email: memberships.invitedEmail,
          schoolName: schools.name,
        })
        .from(memberships)
        .leftJoin(users, eq(users.id, memberships.userId))
        .leftJoin(schools, eq(schools.id, memberships.schoolId))
        .where(eq(memberships.id, request.studentMembershipId))
    : [];

  const mode = request.submissionType === 'online' ? 'online' : 'paper';
  const questions = mode === 'online' ? await getQuestionMarks(request.submissionId) : [];
  const currentScore = request.currentScore !== null ? Number(request.currentScore) : null;

  return (
    <div className="space-y-6 text-slate-900">
      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-xl font-bold">
              {student?.name || student?.email || 'Entrant'}
            </h2>
            <p className="text-sm text-slate-600">
              {request.roundName}
              {student?.schoolName ? ` · ${student.schoolName}` : ''} ·{' '}
              {mode === 'online' ? 'Online test' : 'Paper test'}
            </p>
          </div>
          <span
            className={`self-start px-3 py-1 text-xs font-bold rounded ${
              request.status === 'pending'
                ? 'bg-amber-100 text-amber-900'
                : 'bg-green-100 text-green-800'
            }`}
          >
            {request.status === 'pending' ? 'Awaiting remark' : 'Resolved'}
          </span>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-amber-800 mb-1">
            Entrant&apos;s reason · {formatDate(request.createdAt)}
          </div>
          <p className="whitespace-pre-wrap text-slate-800">{request.reason}</p>
        </div>
        {mode === 'paper' && request.fileUrl && (
          <a
            href={request.fileUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-block mt-4 text-sm font-semibold text-blue-700 hover:underline"
          >
            Open the uploaded script &rarr;
          </a>
        )}
      </div>

      {request.status === 'pending' ? (
        <RemarkResolver
          requestId={request.id}
          mode={mode}
          questions={questions}
          currentScore={currentScore}
          doneHref={doneHref}
        />
      ) : (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6">
          <div className="text-sm mb-2">
            Mark {request.previousScore ?? '—'} → <strong>{request.newScore ?? '—'}</strong>
            {request.resolvedAt && <> · {formatDate(request.resolvedAt)}</>}
          </div>
          <p className="whitespace-pre-wrap text-green-950">{request.responseNote}</p>
        </div>
      )}
    </div>
  );
}
