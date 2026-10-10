import { db } from '@/lib/db';
import { memberships, schools, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  canResolveRemark,
  getQuestionMarks,
  getRemarkRequest,
  REMARK_MAX_ATTEMPTS,
} from '@/domain/remarks/remarks';
import { getScriptPages } from '@/domain/scripts/script-pages';
import { parseStoredPins } from '@/domain/scripts/script-rules';
import ScriptViewer, { type ScriptPageSet } from '@/components/scripts/ScriptViewer';
import { PinNotes } from '@/components/scripts/PinOverlay';
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

  // Paper: the uploaded script with the entrant's pins, plus any re-marked pages
  const pins = parseStoredPins(request.pins);
  const scriptSets: ScriptPageSet[] = [];
  if (mode === 'paper') {
    const pages = await getScriptPages(request.submissionId);
    const originalIds = pages.filter((p) => p.kind === 'original').map((p) => p.id);
    const remarkedIds = pages
      .filter((p) => p.kind === 'remarked' && p.remarkRequestId === request.id)
      .map((p) => p.id);
    if (originalIds.length > 0) {
      scriptSets.push({ key: 'original', label: 'Original', pageIds: originalIds, pins });
    }
    if (remarkedIds.length > 0) {
      scriptSets.push({ key: 'remarked', label: 'After remark', pageIds: remarkedIds });
    }
  }

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
          <div className="self-start flex flex-col items-end gap-1">
            <span
              className={`px-3 py-1 text-xs font-bold rounded ${
                request.status === 'pending'
                  ? 'bg-amber-100 text-amber-900'
                  : request.status === 'withdrawn'
                    ? 'bg-slate-100 text-slate-600'
                    : 'bg-green-100 text-green-800'
              }`}
            >
              {request.status === 'pending'
                ? 'Awaiting remark'
                : request.status === 'withdrawn'
                  ? 'Withdrawn'
                  : 'Resolved'}
            </span>
            <span className="text-xs text-slate-500">
              Request {request.attempt} of {REMARK_MAX_ATTEMPTS}
            </span>
          </div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-amber-800 mb-1">
            Entrant&apos;s reason · {formatDate(request.createdAt)}
          </div>
          {request.questionRefs && (
            <p className="text-slate-800 mb-1">
              <span className="font-semibold">Questions:</span> {request.questionRefs}
            </p>
          )}
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

      {mode === 'paper' && (
        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4">
            Marked script
          </h3>
          {scriptSets.length === 0 && (
            <p className="text-sm text-slate-600 mb-4">
              The school hasn&apos;t uploaded this entrant&apos;s marked script.
            </p>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {scriptSets.length > 0 && (
              <div className="lg:col-span-2">
                <ScriptViewer sets={scriptSets} />
              </div>
            )}
            {pins.length > 0 && (
              <div className={scriptSets.length > 0 ? '' : 'lg:col-span-3'}>
                <div className="text-xs font-bold uppercase tracking-wider text-amber-800 mb-2">
                  Entrant&apos;s pins
                </div>
                <PinNotes pins={pins} />
              </div>
            )}
          </div>
        </div>
      )}

      {request.status === 'pending' ? (
        <RemarkResolver
          requestId={request.id}
          mode={mode}
          questions={questions}
          currentScore={currentScore}
          doneHref={doneHref}
        />
      ) : request.status === 'withdrawn' ? (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-6 text-sm text-slate-700">
          The entrant withdrew this request before it was remarked. Nothing to do.
        </div>
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
