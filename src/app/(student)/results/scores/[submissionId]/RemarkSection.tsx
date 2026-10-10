import { REMARK_MAX_ATTEMPTS, type RemarkEligibility } from '@/domain/remarks/remarks';
import { parseStoredPins } from '@/domain/scripts/script-rules';
import { PinNotes } from '@/components/scripts/PinOverlay';
import RequestRemarkButton from './RequestRemarkButton';
import WithdrawRemarkButton from './WithdrawRemarkButton';

type Remark = {
  id: string;
  status: 'pending' | 'resolved' | 'withdrawn';
  reason: string;
  questionRefs?: string | null;
  pins?: unknown;
  previousScore: string | null;
  newScore: string | null;
  responseNote: string | null;
} | null;

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * The entrant's appeal: the current request (pending, with the option to
 * withdraw it, or its outcome), the option to appeal while attempts remain,
 * and how many of the REMARK_MAX_ATTEMPTS they have used.
 * `remark` is the latest request that wasn't withdrawn; `lastWithdrawn` says
 * the most recent one was. `paperPageIds` (paper scripts only) are the
 * original pages pins go on.
 */
export default function RemarkSection({
  submissionId,
  remark,
  eligibility,
  attemptsUsed = 0,
  lastWithdrawn = false,
  paperPageIds,
}: {
  submissionId: string;
  remark: Remark;
  eligibility: RemarkEligibility;
  attemptsUsed?: number;
  lastWithdrawn?: boolean;
  paperPageIds?: string[];
}) {
  const attemptsLeft = Math.max(0, REMARK_MAX_ATTEMPTS - attemptsUsed);
  // Only worth mentioning once the entrant can (or could) appeal
  const showAttempts = eligibility.eligible || attemptsUsed > 0;

  let current = null;
  if (remark) {
    const resolved = remark.status === 'resolved';
    const pins = parseStoredPins(remark.pins);
    current = (
      <div className={`p-6 border-2 ${resolved ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
        <h3 className={`font-bold uppercase tracking-wider text-sm mb-2 ${resolved ? 'text-green-800' : 'text-amber-800'}`}>
          {resolved ? 'Remark completed' : 'Remark requested — awaiting review'}
        </h3>
        {remark.questionRefs && (
          <p className="text-slate-700 font-medium">
            <span className="opacity-70 mr-2">Questions:</span> {remark.questionRefs}
          </p>
        )}
        <p className="text-slate-700 font-medium">
          <span className="opacity-70 mr-2">Your reason:</span> {remark.reason}
        </p>
        {pins.length > 0 && (
          <div className="mt-3">
            <PinNotes pins={pins} />
          </div>
        )}
        {resolved && (
          <div className="mt-3 pt-3 border-t border-black/5 text-slate-900">
            <p className="font-bold">
              {remark.previousScore === remark.newScore
                ? `Your mark was confirmed at ${remark.newScore}.`
                : `Your mark changed from ${remark.previousScore} to ${remark.newScore}.`}
            </p>
            {remark.responseNote && (
              <p className="mt-1 whitespace-pre-wrap">{remark.responseNote}</p>
            )}
          </div>
        )}
        {remark.status === 'pending' && (
          <div className="mt-4 pt-3 border-t border-black/5">
            <WithdrawRemarkButton
              submissionId={submissionId}
              requestId={remark.id}
              hasAttemptLeft={attemptsLeft > 0}
            />
          </div>
        )}
      </div>
    );
  }

  const form = eligibility.eligible ? (
    <div className="bg-white border-2 border-slate-200 p-8 flex flex-col md:flex-row items-center justify-between gap-6 shadow-sm">
      <div>
        <h3 className="text-lg font-bold text-blue-950 mb-1">
          {remark || lastWithdrawn ? 'Request another remark?' : 'Think there was a mistake?'}
        </h3>
        <p className="text-slate-500 font-medium text-sm">
          {lastWithdrawn && 'You withdrew your last request. '}
          Your school&apos;s educators will review your paper and your mark may go
          up, down or stay the same. Appeals close on {formatDate(eligibility.closesAt)}.
        </p>
      </div>
      <div className="shrink-0">
        <RequestRemarkButton submissionId={submissionId} paperPageIds={paperPageIds} />
      </div>
    </div>
  ) : null;

  if (!current && !form && !showAttempts) return null;

  return (
    <div className="space-y-4">
      {current}
      {form}
      {showAttempts && (
        <p className="text-sm text-slate-500 font-medium" data-testid="remark-attempts">
          You can request a remark up to {REMARK_MAX_ATTEMPTS} times for this paper
          (a withdrawn request counts).{' '}
          {attemptsLeft === 0
            ? 'You have used all your requests.'
            : `You have ${attemptsLeft} of ${REMARK_MAX_ATTEMPTS} left.`}
        </p>
      )}
    </div>
  );
}
