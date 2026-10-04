/**
 * Physical-marking settings for paper and hybrid rounds. Both fields are
 * optional; the round actions parse the deadline as SAST.
 */
export default function PaperMarkingFields({
  defaultMarkingClosesAt = '',
  defaultPaperTotalMarks,
}: {
  defaultMarkingClosesAt?: string;
  defaultPaperTotalMarks?: number | null;
}) {
  const inputClass =
    'w-full p-3 border border-slate-300 rounded-md text-slate-900 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none';
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div>
        <label className="block text-sm font-semibold text-slate-900 mb-2" htmlFor="markingClosesAt">
          Marking Deadline (SAST)
        </label>
        <input
          type="datetime-local"
          id="markingClosesAt"
          name="markingClosesAt"
          defaultValue={defaultMarkingClosesAt}
          className={inputClass}
        />
        <p className="text-xs text-slate-500 mt-1">
          When schools must have entered physical marks by. Leave empty for 24
          hours after the round closes.
        </p>
      </div>
      <div>
        <label className="block text-sm font-semibold text-slate-900 mb-2" htmlFor="paperTotalMarks">
          Total Marks (paper)
        </label>
        <input
          type="number"
          id="paperTotalMarks"
          name="paperTotalMarks"
          min="1"
          step="1"
          placeholder="e.g. 100"
          defaultValue={defaultPaperTotalMarks ?? ''}
          className={inputClass}
        />
        <p className="text-xs text-slate-500 mt-1">
          Marks obtainable on the paper. Used to check entered marks and work
          out percentages when the round has no question bank.
        </p>
      </div>
    </div>
  );
}
