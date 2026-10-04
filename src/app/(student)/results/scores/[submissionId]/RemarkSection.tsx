import type { RemarkEligibility } from '@/domain/remarks/remarks';
import RequestRemarkButton from './RequestRemarkButton';

type Remark = {
  status: 'pending' | 'resolved';
  reason: string;
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

/** The entrant's appeal: its status/outcome, or the option to appeal. */
export default function RemarkSection({
  submissionId,
  remark,
  eligibility,
}: {
  submissionId: string;
  remark: Remark;
  eligibility: RemarkEligibility;
}) {
  if (remark) {
    const resolved = remark.status === 'resolved';
    return (
      <div className={`p-6 border-2 ${resolved ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
        <h3 className={`font-bold uppercase tracking-wider text-sm mb-2 ${resolved ? 'text-green-800' : 'text-amber-800'}`}>
          {resolved ? 'Remark completed' : 'Remark requested — awaiting review'}
        </h3>
        <p className="text-slate-700 font-medium">
          <span className="opacity-70 mr-2">Your reason:</span> {remark.reason}
        </p>
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
      </div>
    );
  }

  if (!eligibility.eligible) return null;

  return (
    <div className="bg-white border-2 border-slate-200 p-8 flex flex-col md:flex-row items-center justify-between gap-6 shadow-sm">
      <div>
        <h3 className="text-lg font-bold text-blue-950 mb-1">Think there was a mistake?</h3>
        <p className="text-slate-500 font-medium text-sm">
          You can ask for your paper to be remarked once. Your school&apos;s
          educators will review it and your mark may go up, down or stay the
          same. Appeals close on {formatDate(eligibility.closesAt)}.
        </p>
      </div>
      <div className="shrink-0">
        <RequestRemarkButton submissionId={submissionId} />
      </div>
    </div>
  );
}
