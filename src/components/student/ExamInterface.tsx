'use client';

import { useCallback, useEffect, useState } from 'react';

export interface QuestionData {
  id: string;
  questionType:
    | 'single_choice'
    | 'multiple_choice'
    | 'true_false'
    | 'matching'
    | 'free_text';
  prompt: string;
  imageUrl?: string | null;
  marks: number;
  options?: any;
}

interface ExamInterfaceProps {
  sittingId: string;
  durationMinutes: number;
  startedAt: string;
  initialAnswers: Record<string, string>;
  questions: QuestionData[];
  testTitle: string;
}

export default function ExamInterface({
  sittingId,
  durationMinutes,
  startedAt,
  initialAnswers,
  questions,
  testTitle,
}: ExamInterfaceProps) {
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState('');
  const [shuffledOptions, setShuffledOptions] = useState<Record<string, any>>({});
  const [isHydrated, setIsHydrated] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const localKey = `exam_answers_${sittingId}`;

  // Keep the original question layout and option presentation, while making
  // the option order stable for the lifetime of this browser attempt.
  useEffect(() => {
    const shuffled: Record<string, any> = {};
    questions.forEach((q) => {
      if (!q.options) return;
      if (q.questionType === 'single_choice' || q.questionType === 'multiple_choice') {
        const opts = [...q.options];
        for (let i = opts.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [opts[i], opts[j]] = [opts[j], opts[i]];
        }
        shuffled[q.id] = opts;
      } else if (q.questionType === 'matching') {
        const pairs = [...q.options];
        const responses = pairs.map((p: any) => p.response);
        for (let i = responses.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [responses[i], responses[j]] = [responses[j], responses[i]];
        }
        shuffled[q.id] = responses;
      }
    });
    setShuffledOptions(shuffled);
  }, [questions]);

  // Restore the local copy after a refresh/reconnect.
  useEffect(() => {
    try {
      const localStr = localStorage.getItem(localKey);
      if (localStr) {
        const localAnswers = JSON.parse(localStr);
        setAnswers((prev) => ({ ...prev, ...localAnswers }));
      }
    } catch (e) {
      console.error('Failed to parse local answers', e);
    } finally {
      setIsHydrated(true);
    }
  }, [localKey]);

  const syncLocalAnswers = useCallback(async () => {
    if (!navigator.onLine) return;

    let local: Record<string, string> = {};
    try {
      local = JSON.parse(localStorage.getItem(localKey) || '{}');
    } catch {
      return;
    }

    const entries = Object.entries(local);
    if (!entries.length) return;

    setIsSyncing(true);
    try {
      for (const [questionId, answerValue] of entries) {
        const res = await fetch('/api/student/sitting/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sittingId, questionId, answerValue }),
        });
        if (res.ok) delete local[questionId];
      }
      localStorage.setItem(localKey, JSON.stringify(local));
      if (Object.keys(local).length === 0) setError('');
    } catch {
      // Keep the local copy so it can be retried when the connection returns.
    } finally {
      setIsSyncing(false);
    }
  }, [localKey, sittingId]);

  const submitAttempt = useCallback(async (automatic = false) => {
    if (submitted) return;
    setIsSyncing(true);
    try {
      // Try to push any locally queued answers before closing the attempt.
      await syncLocalAnswers();

      const res = await fetch('/api/student/sitting/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sittingId }),
      });

      if (!res.ok) throw new Error('Failed to submit');

      localStorage.removeItem(localKey);
      setSubmitted(true);
      window.location.href = '/results';
    } catch {
      setError(
        automatic
          ? 'Time has expired, but the connection is unavailable. Your answers remain saved on this device and will be submitted when you reconnect.'
          : 'Could not submit your attempt. Your answers remain saved and you can try again when the connection returns.'
      );
    } finally {
      setIsSyncing(false);
    }
  }, [localKey, sittingId, submitted, syncLocalAnswers]);

  // Server-based timer: refreshing the page does not restart the clock.
  useEffect(() => {
    const startTime = new Date(startedAt).getTime();
    const endTime = startTime + durationMinutes * 60 * 1000;

    const tick = () => {
      const remaining = Math.max(0, endTime - Date.now());
      setTimeLeft(remaining);
      if (remaining <= 0) submitAttempt(true);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startedAt, durationMinutes, submitAttempt]);

  // Retry queued answers whenever the connection comes back.
  useEffect(() => {
    const reconnect = () => {
      syncLocalAnswers();
    };
    window.addEventListener('online', reconnect);
    return () => window.removeEventListener('online', reconnect);
  }, [syncLocalAnswers]);

  const handleAnswerChange = async (questionId: string, answerValue: string) => {
    const newAnswers = { ...answers, [questionId]: answerValue };
    setAnswers(newAnswers);

    // Always keep the complete current answer set locally. This means a
    // browser refresh during a network outage does not lose work.
    try {
      localStorage.setItem(localKey, JSON.stringify(newAnswers));
    } catch {
      // The server save below may still succeed.
    }

    setIsSyncing(true);
    try {
      const res = await fetch('/api/student/sitting/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sittingId, questionId, answerValue }),
      });
      if (!res.ok) throw new Error('Failed to save');

      // Remove only this successfully saved answer from the offline queue.
      try {
        const local = JSON.parse(localStorage.getItem(localKey) || '{}');
        delete local[questionId];
        localStorage.setItem(localKey, JSON.stringify(local));
      } catch {}
      setError('');
    } catch {
      setError('Connection issues. Your answer is saved locally.');
    } finally {
      setIsSyncing(false);
    }
  };

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  if (submitted) {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-50 text-slate-700">
        Submitting attempt...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans">
      <div className="max-w-5xl mx-auto">
        <div className="flex justify-between items-center border-b border-slate-300 pb-4 mb-8 bg-slate-50 sticky top-0 z-10">
          <div>
            <h1 className="text-3xl font-serif font-bold text-slate-800">
              {testTitle}
            </h1>
            <div className="text-sm text-slate-500 mt-1">
              {Object.keys(answers).filter((key) => questions.some((q) => q.id === key && answers[key])).length} of {questions.length} answered
              {isSyncing && <span className="ml-3">Saving...</span>}
            </div>
          </div>
          <div className="text-right bg-white px-4 py-2 border border-slate-200 rounded-md shadow-sm">
            <div className="text-sm text-slate-600 font-semibold mb-1">
              Time left
            </div>
            <div
              className={`text-xl font-mono font-bold ${timeLeft < 300000 ? 'text-red-600' : 'text-slate-800'}`}
            >
              {formatTime(timeLeft)}
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded-md mb-6 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-8">
          {!isHydrated ? (
            <div className="text-center py-12 text-slate-500 font-medium animate-pulse">
              Loading exam questions...
            </div>
          ) : (
            questions.map((q, idx) => {
              const isAnswered = !!answers[q.id];
              return (
                <div key={q.id} className="flex flex-col md:flex-row gap-6">
                  {/* Original Moodle-style question sidebar preserved. */}
                  <div className="md:w-48 shrink-0 bg-slate-100 border border-slate-300 rounded-sm p-4 h-fit">
                    <h3 className="font-bold text-slate-800 text-lg mb-2">
                      Question {idx + 1}
                    </h3>
                    <div className="text-sm text-slate-700 font-medium mb-4">
                      {isAnswered ? 'Answer saved' : 'Not yet answered'}
                    </div>
                    <div className="text-sm text-slate-600">
                      Marked out of {q.marks.toFixed(2)}
                    </div>
                    <div className="text-sm text-slate-600 mt-2 cursor-pointer hover:underline">
                      Flag question
                    </div>
                  </div>

                  {/* Original question card and spacing preserved. */}
                  <div className="flex-1 bg-white border border-slate-300 shadow-sm rounded-sm p-6">
                    <div className="text-slate-800 mb-6 whitespace-pre-wrap">
                      {q.prompt}
                    </div>

                    {q.imageUrl && (
                      <div className="mb-6">
                        <img
                          src={q.imageUrl}
                          alt="Question Graphic"
                          className="max-w-full rounded border border-slate-200"
                        />
                      </div>
                    )}

                    <div className="space-y-3">
                      {q.questionType === 'true_false' && (
                        <div className="flex flex-col gap-2">
                          {['True', 'False'].map((opt) => (
                            <label
                              key={opt}
                              className="flex items-center gap-3 cursor-pointer"
                            >
                              <input
                                type="radio"
                                name={`q_${q.id}`}
                                checked={answers[q.id] === opt}
                                onChange={() => handleAnswerChange(q.id, opt)}
                                className="w-4 h-4 text-blue-600"
                              />
                              <span className="text-slate-700">{opt}</span>
                            </label>
                          ))}
                        </div>
                      )}

                      {q.questionType === 'single_choice' && shuffledOptions[q.id] && (
                        <div className="flex flex-col gap-2">
                          {shuffledOptions[q.id].map((opt: string) => (
                            <label
                              key={opt}
                              className="flex items-center gap-3 cursor-pointer"
                            >
                              <input
                                type="radio"
                                name={`q_${q.id}`}
                                checked={answers[q.id] === opt}
                                onChange={() => handleAnswerChange(q.id, opt)}
                                className="w-4 h-4 text-blue-600"
                              />
                              <span className="text-slate-700">{opt}</span>
                            </label>
                          ))}
                        </div>
                      )}

                      {q.questionType === 'multiple_choice' && shuffledOptions[q.id] && (
                        <div className="flex flex-col gap-2">
                          {shuffledOptions[q.id].map((opt: string) => (
                            <label
                              key={opt}
                              className="flex items-center gap-3 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={answers[q.id]?.split(',').includes(opt) || false}
                                onChange={(e) => {
                                  const curr = answers[q.id]
                                    ? answers[q.id].split(',').filter(Boolean)
                                    : [];
                                  const next = e.target.checked
                                    ? [...new Set([...curr, opt])]
                                    : curr.filter((x) => x !== opt);
                                  handleAnswerChange(q.id, next.join(','));
                                }}
                                className="w-4 h-4 text-blue-600"
                              />
                              <span className="text-slate-700">{opt}</span>
                            </label>
                          ))}
                        </div>
                      )}

                      {q.questionType === 'matching' && shuffledOptions[q.id] && (
                        <div className="flex flex-col gap-3">
                          {q.options?.map((pair: any, pIdx: number) => (
                            <div
                              key={pIdx}
                              className="flex items-center gap-4"
                            >
                              <span className="text-slate-700 w-32 font-medium">
                                {pair.premise}
                              </span>
                              <select
                                className="border border-slate-300 rounded p-1.5 bg-white text-slate-700 flex-1 max-w-xs"
                                value={answers[`${q.id}_${pIdx}`] || ''}
                                onChange={(e) =>
                                  handleAnswerChange(
                                    `${q.id}_${pIdx}`,
                                    e.target.value
                                  )
                                }
                              >
                                <option value="">Choose match...</option>
                                {shuffledOptions[q.id].map(
                                  (resp: string, rIdx: number) => (
                                    <option key={rIdx} value={resp}>
                                      {resp}
                                    </option>
                                  )
                                )}
                              </select>
                            </div>
                          ))}
                        </div>
                      )}

                      {q.questionType === 'free_text' && (
                        <textarea
                          rows={8}
                          className="w-full border border-slate-300 rounded-sm p-3 text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          value={answers[q.id] || ''}
                          onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                          placeholder="Type your explanation here..."
                        />
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="mt-8 flex justify-center">
          <button
            disabled={isSyncing || !isHydrated}
            onClick={() => {
              if (window.confirm('Submit your attempt? You will not be able to change your answers afterwards.')) {
                submitAttempt(false);
              }
            }}
            className="bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold py-2 px-6 rounded transition-colors mr-4 disabled:opacity-50"
          >
            Finish attempt...
          </button>
        </div>
      </div>
    </div>
  );
}
