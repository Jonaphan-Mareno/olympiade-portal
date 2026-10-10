import type { MemoEntry } from '@/domain/memo/memo';

const CHOICE_OR_MATCHING = ['single_choice', 'multiple_choice', 'true_false', 'matching'];

/**
 * The round's memo, shown beside the entrant's marked script so they can
 * check each answer before deciding whether to appeal. Built from the same
 * data as the printed memo (domain/memo), so letters and answers match it.
 */
export default function MemoPanel({
  roundId,
  entries,
  hasUploadedMemo,
}: {
  roundId: string;
  entries: MemoEntry[];
  hasUploadedMemo: boolean;
}) {
  const memoHref = `/api/rounds/${roundId}/paper?kind=memo`;
  const paperHref = `/api/rounds/${roundId}/paper?kind=paper`;

  return (
    <aside className="bg-white border-2 border-slate-200 flex flex-col lg:max-h-[calc(100vh-6rem)]">
      <div className="px-5 py-4 border-b-2 border-slate-200 bg-slate-50">
        <h3 className="font-bold text-blue-950 uppercase tracking-wider text-sm">Memo</h3>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs font-bold">
          <a href={memoHref} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
            {hasUploadedMemo ? 'Official memo (PDF)' : 'Download memo (PDF)'}
          </a>
          <a href={paperHref} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
            Question paper (PDF)
          </a>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="p-5 text-sm text-slate-600 flex-1">
          {hasUploadedMemo ? (
            <>
              <p className="mb-3">The organiser uploaded this memo as a PDF.</p>
              <iframe
                src={memoHref}
                title="Memo"
                className="hidden lg:block w-full h-[70vh] border border-slate-200"
              />
            </>
          ) : (
            <p>No memo is available for this round.</p>
          )}
        </div>
      ) : (
        <ol className="overflow-y-auto divide-y divide-slate-100 text-sm text-slate-800">
          {entries.map((e) => (
            <li key={e.number} className="p-5 space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-bold text-blue-950">Question {e.number}</span>
                <span className="text-xs font-bold text-slate-500 shrink-0">
                  {e.marks} mark{e.marks === 1 ? '' : 's'}
                </span>
              </div>
              {e.prompt && <p className="text-slate-600 whitespace-pre-wrap">{e.prompt}</p>}

              {e.options.length > 0 && (
                <ul className="space-y-1">
                  {e.options.map((o) => (
                    <li
                      key={o.letter}
                      className={`px-2 py-1 border ${
                        o.correct
                          ? 'border-green-500 bg-green-50 text-green-900 font-bold'
                          : 'border-transparent text-slate-600'
                      }`}
                    >
                      {o.letter}. {o.text}
                      {o.correct && <span className="sr-only"> (correct)</span>}
                    </li>
                  ))}
                </ul>
              )}

              {e.pairs.length > 0 && (
                <ul className="space-y-1">
                  {e.pairs.map((p, i) => (
                    <li key={i}>
                      <span className="font-medium">{i + 1}. {p.premise}</span>
                      <span className="text-slate-400"> &rarr; </span>
                      <span className="font-bold text-green-800">
                        {p.letter}. {p.response}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {e.answer && (
                <p className="font-bold text-green-800">Answer: {e.answer}</p>
              )}
              {(e.type === 'single_choice' || e.type === 'multiple_choice' || e.type === 'true_false') &&
                !e.answer && <p className="text-slate-500 italic">No answer was set.</p>}

              {!CHOICE_OR_MATCHING.includes(e.type) && (
                <div className="bg-blue-50 border border-blue-200 p-2">
                  <div className="text-xs font-bold text-blue-800 uppercase tracking-wider mb-1">
                    Marking guideline
                  </div>
                  <p className="whitespace-pre-wrap text-blue-950">
                    {e.guideline ?? 'No guideline was provided.'}
                  </p>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
