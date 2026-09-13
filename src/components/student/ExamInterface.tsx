'use client';

import { useState, useEffect } from 'react';

export interface QuestionData {
  id: string;
  questionType: 'single_choice' | 'multiple_choice' | 'true_false' | 'matching' | 'free_text';
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

  // Initialize Shuffled Options
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
    setIsHydrated(true);
  }, [questions]);

  // Hydrate from localStorage
  useEffect(() => {
    try {
      const localStr = localStorage.getItem(`exam_answers_${sittingId}`);
      if (localStr) {
        const localAnswers = JSON.parse(localStr);
        setAnswers((prev) => ({ ...prev, ...localAnswers }));
      }
    } catch (e) {
      console.error('Failed to parse local answers', e);
    }
  }, [sittingId]);

  // Timer logic
  useEffect(() => {
    const startTime = new Date(startedAt).getTime();
    const durationMs = durationMinutes * 60 * 1000;
    const endTime = startTime + durationMs;

    const tick = () => {
      const now = Date.now();
      const remaining = Math.max(0, endTime - now);
      setTimeLeft(remaining);

      if (remaining <= 0) {
        // Auto-submit logic would go here
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startedAt, durationMinutes]);

  const handleAnswerChange = async (questionId: string, answerValue: string) => {
    const newAnswers = { ...answers, [questionId]: answerValue };
    setAnswers(newAnswers);

    localStorage.setItem(`exam_answers_${sittingId}`, JSON.stringify(newAnswers));

    setIsSyncing(true);
    try {
      const res = await fetch('/api/student/sitting/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sittingId,
          questionId,
          answerValue,
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setError('');
    } catch (err: any) {
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

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans">
      <div className="max-w-5xl mx-auto">
        <div className="flex justify-between items-center border-b border-slate-300 pb-4 mb-8 bg-slate-50 sticky top-0 z-10">
          <h1 className="text-3xl font-serif font-bold text-slate-800">{testTitle}</h1>
          <div className="text-right bg-white px-4 py-2 border border-slate-200 rounded-md shadow-sm">
            <div className="text-sm text-slate-600 font-semibold mb-1">Time left</div>
            <div className={`text-xl font-mono font-bold ${timeLeft < 300000 ? 'text-red-600' : 'text-slate-800'}`}>
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
             <div className="text-center py-12 text-slate-500 font-medium animate-pulse">Loading exam questions...</div>
          ) : questions.map((q, idx) => {
            const isAnswered = !!answers[q.id];
            return (
              <div key={q.id} className="flex flex-col md:flex-row gap-6">
                {/* Moodle left sidebar per question */}
                <div className="md:w-48 shrink-0 bg-slate-100 border border-slate-300 rounded-sm p-4 h-fit">
                  <h3 className="font-bold text-slate-800 text-lg mb-2">Question {idx + 1}</h3>
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

                {/* Question Content */}
                <div className="flex-1 bg-white border border-slate-300 shadow-sm rounded-sm p-6">
                  <div className="text-slate-800 mb-6 whitespace-pre-wrap">{q.prompt}</div>
                  
                  {q.imageUrl && (
                    <div className="mb-6">
                      <img src={q.imageUrl} alt="Question Graphic" className="max-w-full rounded border border-slate-200" />
                    </div>
                  )}

                  {/* Inputs */}
                  <div className="space-y-3">
                    {q.questionType === 'true_false' && (
                      <div className="flex flex-col gap-2">
                        {['True', 'False'].map(opt => (
                          <label key={opt} className="flex items-center gap-3 cursor-pointer">
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
                          <label key={opt} className="flex items-center gap-3 cursor-pointer">
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
                          <label key={opt} className="flex items-center gap-3 cursor-pointer">
                            <input 
                              type="checkbox" 
                              checked={answers[q.id]?.includes(opt) || false}
                              onChange={(e) => {
                                const curr = answers[q.id] ? answers[q.id].split(',') : [];
                                let next;
                                if (e.target.checked) next = [...curr, opt];
                                else next = curr.filter(x => x !== opt);
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
                          <div key={pIdx} className="flex items-center gap-4">
                            <span className="text-slate-700 w-32 font-medium">{pair.premise}</span>
                            <select 
                              className="border border-slate-300 rounded p-1.5 bg-white text-slate-700 flex-1 max-w-xs"
                              value={answers[`${q.id}_${pIdx}`] || ''}
                              onChange={(e) => handleAnswerChange(`${q.id}_${pIdx}`, e.target.value)}
                            >
                              <option value="">Choose match...</option>
                              {shuffledOptions[q.id].map((resp: string, rIdx: number) => (
                                <option key={rIdx} value={resp}>{resp}</option>
                              ))}
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
          })}
        </div>

        <div className="mt-8 flex justify-center">
          <button className="bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold py-2 px-6 rounded transition-colors mr-4">
            Finish attempt...
          </button>
        </div>
      </div>
    </div>
  );
}
