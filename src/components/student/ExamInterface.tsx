'use client';

import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

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
  // Finish-attempt confirmation modal state.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [isTimerBlurred, setIsTimerBlurred] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isNavOpen, setIsNavOpen] = useState(true);

  useEffect(() => {
    try {
      const storedTheme = localStorage.getItem('test_theme');
      if (storedTheme === 'dark') setIsDarkMode(true);
    } catch {}
  }, []);

  const toggleTheme = () => {
    setIsDarkMode((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('test_theme', next ? 'dark' : 'light');
      } catch {}
      return next;
    });
  };

  useEffect(() => {
    if (timeLeft > 0 && timeLeft <= 300000) {
      setIsTimerBlurred(false);
    }
  }, [timeLeft]);

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

  // Track which questions have been viewed (scrolled into viewport)
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const qId = entry.target.id.replace('question-', '');
            setSeen((prev) => {
              if (prev.has(qId)) return prev;
              const next = new Set(prev);
              next.add(qId);
              return next;
            });
          }
        });
      },
      { threshold: 0.1 }
    );

    if (isHydrated) {
      questions.forEach((q) => {
        const el = document.getElementById(`question-${q.id}`);
        if (el) observer.observe(el);
      });
    }

    return () => observer.disconnect();
  }, [questions, isHydrated]);

  const toggleFlag = (qId: string) => {
    setFlagged((prev) => {
      const next = new Set(prev);
      if (next.has(qId)) next.delete(qId);
      else next.add(qId);
      return next;
    });
  };

  const checkIsAnswered = (q: any) => {
    if (q.questionType === 'matching') {
      if (!q.options || q.options.length === 0) return false;
      return q.options.every((_: any, pIdx: number) => !!answers[`${q.id}_${pIdx}`]);
    }
    return !!answers[q.id];
  };

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

  // Confirmed submission from the modal: keeps the dialog locked while the
  // attempt is finalised, closing it only if submission fails (on success
  // the whole view switches to the submitted state).
  const handleConfirmSubmit = async () => {
    setIsSubmitting(true);
    try {
      await submitAttempt(false);
    } finally {
      setIsSubmitting(false);
      setConfirmOpen(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-50 text-slate-700">
        Submitting attempt...
      </div>
    );
  }

  return (
    <div className={`${isDarkMode ? 'dark' : ''} h-full min-h-screen relative`}>
      {/* Progress bar */}
      <div 
        className="fixed top-0 left-0 h-1 bg-blue-500 z-50 transition-all duration-1000 ease-linear"
        style={{ width: `${Math.max(0, (timeLeft / (durationMinutes * 60 * 1000))) * 100}%` }}
      />
      
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 md:p-8 font-sans transition-colors">
        <div className="max-w-5xl mx-auto">
          <div className="flex justify-between items-center border-b border-slate-300 dark:border-slate-800 pb-4 mb-8 bg-slate-50 dark:bg-slate-950 sticky top-0 z-10 transition-colors">
            <div>
              <h1 className="text-3xl font-serif font-bold text-slate-800 dark:text-slate-100 transition-colors">
                {testTitle}
              </h1>
              <div className="text-sm text-slate-500 dark:text-slate-400 mt-1 transition-colors">
                {questions.filter(checkIsAnswered).length} of {questions.length} answered
                {isSyncing && <span className="ml-3">Saving...</span>}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <button 
                onClick={toggleTheme}
                className="p-2 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-sm"
                title="Toggle Dark Mode"
              >
                {isDarkMode ? '☀️' : '🌙'}
              </button>
              <div className="text-right bg-white dark:bg-slate-900 px-4 py-2 border border-slate-200 dark:border-slate-800 rounded-md shadow-sm transition-colors">
                <div className="text-sm text-slate-600 dark:text-slate-400 font-semibold mb-1 transition-colors">
                  Time left
                </div>
                <div
                  className={`text-xl font-mono font-bold cursor-pointer transition-all select-none ${
                    timeLeft <= 300000 ? 'text-red-600 animate-pulse' : 'text-slate-800 dark:text-slate-100'
                  } ${isTimerBlurred && timeLeft > 300000 ? 'blur-sm opacity-50' : ''}`}
                  onClick={() => {
                    if (timeLeft > 300000) setIsTimerBlurred(!isTimerBlurred);
                  }}
                  title={timeLeft > 300000 ? "Click to toggle blur" : "Time critical"}
                >
                  {formatTime(timeLeft)}
                </div>
              </div>
            </div>
          </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded-md mb-6 text-sm">
            {error}
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-8 items-start">
          <div className="flex-1 space-y-8 min-w-0 w-full">
            {!isHydrated ? (
              <div className="text-center py-12 text-slate-500 font-medium animate-pulse">
                Loading exam questions...
              </div>
            ) : (
              questions.map((q, idx) => {
                const isAnswered = checkIsAnswered(q);
                const isFlagged = flagged.has(q.id);
                return (
                  <div key={q.id} id={`question-${q.id}`} className="flex flex-col md:flex-row gap-6">
                    {/* Original Moodle-style question sidebar preserved. */}
                    <div className="md:w-48 shrink-0 bg-slate-100 dark:bg-blue-950 border border-slate-300 dark:border-blue-900 rounded-sm p-4 h-fit transition-colors">
                      <h3 className="font-bold text-slate-800 dark:text-blue-50 text-lg mb-2 transition-colors">
                        Question {idx + 1}
                      </h3>
                      <div className="text-sm text-slate-700 dark:text-blue-200 font-medium mb-4 transition-colors">
                        {isAnswered ? 'Answer saved' : 'Not yet answered'}
                      </div>
                      <div className="text-sm text-slate-600 dark:text-blue-200 transition-colors">
                        Marked out of {q.marks.toFixed(2)}
                      </div>
                      <div 
                        className="text-sm text-slate-600 dark:text-blue-200 mt-2 cursor-pointer hover:underline flex items-center gap-1 transition-colors"
                        onClick={() => toggleFlag(q.id)}
                      >
                        {isFlagged ? (
                          <><span className="text-red-600 dark:text-red-500">🚩</span> Remove flag</>
                        ) : (
                          <><span className="text-slate-400 dark:text-blue-400">⚑</span> Flag question</>
                        )}
                      </div>
                    </div>

                    {/* Original question card and spacing preserved. */}
                    <div className="flex-1 bg-white dark:bg-blue-950 border border-slate-300 dark:border-blue-900 shadow-sm rounded-sm flex flex-col transition-colors">
                      <div className="bg-blue-50 dark:bg-blue-900/50 border-b-2 border-slate-200 dark:border-blue-800 p-6 rounded-t-sm transition-colors">
                        <div className="text-slate-900 dark:text-white whitespace-pre-wrap font-medium transition-colors">
                          {q.prompt}
                        </div>
                      </div>
                      
                      <div className="p-6 flex-1 text-slate-800 dark:text-blue-50 transition-colors">

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
                              <span className="text-slate-700 dark:text-slate-300">{opt}</span>
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
                              <span className="text-slate-700 dark:text-slate-300">{opt}</span>
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
                              <span className="text-slate-700 dark:text-slate-300">{opt}</span>
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
                              <span className="text-slate-700 dark:text-slate-300 w-32 font-medium">
                                {pair.premise}
                              </span>
                              <select
                                className="border border-slate-300 dark:border-slate-700 rounded p-1.5 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 flex-1 max-w-xs"
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
                          className="w-full border border-slate-300 dark:border-slate-700 rounded-sm p-3 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          value={answers[q.id] || ''}
                          onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                          placeholder="Type your explanation here..."
                        />
                      )}
                    </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
          </div>
          
          {/* Quiz Navigation Sidebar */}
          <div className={`shrink-0 sticky top-24 transition-all duration-300 ${isNavOpen ? 'w-full lg:w-72' : 'w-auto'}`}>
            <button
              onClick={() => setIsNavOpen(!isNavOpen)}
              className="mb-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 text-sm font-semibold transition-colors flex items-center gap-1 justify-end w-full"
            >
              {isNavOpen ? 'Hide Navigation >>' : '<< Show'}
            </button>
            <div className={`bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-sm p-4 transition-colors ${!isNavOpen ? 'hidden' : ''}`}>
              <h3 className="font-bold text-slate-800 dark:text-slate-100 mb-4 transition-colors">Quiz Navigation</h3>
            <div className="grid grid-cols-5 gap-2">
              {questions.map((q, idx) => {
                const isAnswered = checkIsAnswered(q);
                const isSeen = seen.has(q.id);
                const isFlagged = flagged.has(q.id);
                
                let boxClasses = "relative w-full aspect-square flex items-center justify-center font-semibold text-sm cursor-pointer transition-colors border ";
                
                if (isAnswered) {
                  boxClasses += "border-2 border-blue-600 dark:border-blue-500 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100";
                } else if (isSeen) {
                  boxClasses += "bg-red-600 border-red-700 text-white";
                } else {
                  boxClasses += "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800";
                }
                
                return (
                  <div 
                    key={q.id}
                    onClick={() => {
                      document.getElementById(`question-${q.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }}
                    className={boxClasses}
                  >
                    {idx + 1}
                    {isFlagged && (
                      <div className="absolute top-0 right-0 w-0 h-0 border-t-[12px] border-l-[12px] border-t-red-500 border-l-transparent"></div>
                    )}
                  </div>
                );
              })}
            </div>
            
            <button
              disabled={isSyncing || !isHydrated}
              onClick={() => setConfirmOpen(true)}
              className="mt-6 w-full text-slate-800 dark:text-slate-100 font-semibold hover:underline text-left text-sm disabled:opacity-50 transition-colors"
            >
              Finish attempt...
            </button>
          </div>
          </div>
        </div>

        <ConfirmDialog
          open={confirmOpen}
          title="Submit your attempt?"
          description="You will not be able to change your answers afterwards."
          confirmLabel="Submit attempt"
          busyLabel="Submitting…"
          busy={isSubmitting}
          onConfirm={handleConfirmSubmit}
          onCancel={() => setConfirmOpen(false)}
        />
      </div>
    </div>
    </div>
  );
}
