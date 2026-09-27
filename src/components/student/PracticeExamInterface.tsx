'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export interface QuestionData {
  id: string;
  questionType: string;
  prompt: string;
  imageUrl?: string | null;
  marks: number;
  options?: any;
  correctAnswer?: any;
}

interface PracticeExamInterfaceProps {
  questions: QuestionData[];
  testTitle: string;
}

export default function PracticeExamInterface({
  questions,
  testTitle,
}: PracticeExamInterfaceProps) {
  // Use a unique key per test for local storage
  const localKey = `practice_answers_${testTitle.replace(/\s+/g, '_')}`;

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [showAnswerFor, setShowAnswerFor] = useState<Record<string, boolean>>({});
  const [isFinished, setIsFinished] = useState(false);
  const [score, setScore] = useState(0);
  const [isHydrated, setIsHydrated] = useState(false);
  
  const totalMarks = questions.reduce((sum, q) => q.questionType !== 'free_text' ? sum + (q.marks || 1) : sum, 0);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(localKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.answers !== undefined) {
          setAnswers(parsed.answers || {});
          setShowAnswerFor(parsed.showAnswerFor || {});
          setIsFinished(parsed.isFinished || false);
          setScore(parsed.score || 0);
        } else {
          // Legacy format migration
          setAnswers(parsed);
        }
      }
    } catch {}
    setIsHydrated(true);
  }, [localKey]);

  useEffect(() => {
    if (isHydrated) {
      localStorage.setItem(localKey, JSON.stringify({ answers, showAnswerFor, isFinished, score }));
    }
  }, [answers, showAnswerFor, isFinished, score, isHydrated, localKey]);

  const calculateEarnedMarks = (q: any, studentAnsRaw: string | undefined): number => {
    const maxMarks = q.marks ?? 1;
    if (q.questionType === 'free_text') return 0;
    if (!studentAnsRaw) return 0;

    if (q.questionType === 'matching') {
       let studentAnsObj: any = {};
       try { studentAnsObj = JSON.parse(studentAnsRaw); } catch {}
       if (typeof studentAnsObj !== 'object') return 0;

       let correctPairs = 0;
       let totalPairs = 0;
       if (Array.isArray(q.options)) {
          q.options.forEach((opt: any, index: number) => {
             totalPairs++;
             if (studentAnsObj[`${q.id}_${index}`] === opt.response) {
                 correctPairs++;
             }
          });
       }
       if (totalPairs === 0) return 0;
       return (correctPairs / totalPairs) * maxMarks;
    }

    let correctSelections: string[] = [];
    const strCorrect = typeof q.correctAnswer === 'string' || typeof q.correctAnswer === 'number' || typeof q.correctAnswer === 'boolean' ? String(q.correctAnswer) : '';
    try {
        const parsed = JSON.parse(strCorrect);
        correctSelections = Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
    } catch {
        if (!strCorrect.startsWith('[')) {
            correctSelections = strCorrect.split(',').map((s: string) => s.trim()).filter(Boolean);
        } else {
            correctSelections = [strCorrect];
        }
    }

    if (Array.isArray(q.correctAnswer)) {
      correctSelections = q.correctAnswer.map(String);
    } else if (typeof q.correctAnswer === 'object' && q.correctAnswer !== null && q.correctAnswer.text !== undefined) {
      correctSelections = [String(q.correctAnswer.text)];
    }

    let studentSelections: string[] = [];
    try {
      const parsed = JSON.parse(studentAnsRaw);
      studentSelections = Array.isArray(parsed) ? parsed.map(String) : [String(studentAnsRaw)];
    } catch {
      studentSelections = [studentAnsRaw];
    }

    if (q.questionType === 'multiple_choice') {
      const totalCorrect = correctSelections.length;
      if (totalCorrect === 0) return 0;
      let matches = 0;
      studentSelections.forEach(s => {
          if (correctSelections.includes(s)) matches++;
      });
      return (matches / totalCorrect) * maxMarks;
    }

    const isCorrect = correctSelections.length === 1 && studentSelections.length === 1 && correctSelections[0] === studentSelections[0];
    if (isCorrect) return maxMarks;

    const studentStr = studentSelections.join(',').toLowerCase();
    const correctStr = correctSelections.join(',').toLowerCase();
    
    return studentStr === correctStr ? maxMarks : 0;
  };

  const handleFinish = () => {
    let earned = 0;
    questions.forEach(q => {
      const ans = answers[q.id];
      if (ans) {
        earned += calculateEarnedMarks(q, ans);
      }
    });
    setScore(earned);
    setIsFinished(true);
    
    // Automatically show all answers
    const allShown: Record<string, boolean> = {};
    questions.forEach(q => { allShown[q.id] = true; });
    setShowAnswerFor(allShown);
  };

  const handleRetry = () => {
    setAnswers({});
    setShowAnswerFor({});
    setIsFinished(false);
    setScore(0);
    localStorage.removeItem(localKey);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const setAnswer = (questionId: string, value: string) => {
    if (isFinished) return;
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const toggleShowAnswer = (questionId: string) => {
    setShowAnswerFor(prev => ({ ...prev, [questionId]: !prev[questionId] }));
  };

  const renderCorrectAnswer = (q: any) => {
    if (q.questionType === 'matching') {
        const correctMap = new Map();
        if (Array.isArray(q.options)) {
            q.options.forEach((opt: any) => {
               correctMap.set(opt.premise, opt.response);
            });
        }
        return (
            <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-md">
                <p className="font-bold text-green-800 mb-2">Correct Matching:</p>
                <ul className="space-y-1">
                    {Array.from(correctMap.entries()).map(([premise, response], i) => (
                        <li key={i} className="text-green-700"><span className="font-semibold">{premise}</span> ➔ {response}</li>
                    ))}
                </ul>
            </div>
        );
    }

    if (!q.correctAnswer) return <div className="text-slate-500 italic mt-2">No correct answer provided.</div>;
    
    let correctSelections: string[] = [];
    if (typeof q.correctAnswer === 'string' || typeof q.correctAnswer === 'number' || typeof q.correctAnswer === 'boolean') {
      const strVal = String(q.correctAnswer);
      try {
        const parsed = JSON.parse(strVal);
        correctSelections = Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
      } catch {
        if (!strVal.startsWith('[')) {
          correctSelections = strVal.split(',').map(s => String(s).trim()).filter(Boolean);
        } else {
          correctSelections = [strVal];
        }
      }
    } else if (typeof q.correctAnswer === 'object' && q.correctAnswer !== null) {
      if (Array.isArray(q.correctAnswer)) {
        correctSelections = q.correctAnswer.map(String);
      } else if (q.correctAnswer.text !== undefined) {
        correctSelections = [String(q.correctAnswer.text)];
      }
    }

    return (
      <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-md">
        <p className="font-bold text-green-800 mb-2">Correct Answer:</p>
        <ul className="list-disc list-inside space-y-1">
          {correctSelections.map((sel, i) => (
            <li key={i} className="text-green-700">{sel}</li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-24">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 shadow-sm sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 md:px-8 py-4 flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">
              Practice Mode
            </span>
            <h1 className="text-xl md:text-2xl font-bold text-blue-950 font-serif">
              {testTitle}
            </h1>
          </div>
          <Link href="/results/past-papers" className="text-sm font-semibold text-slate-500 hover:text-slate-800 transition-colors">
            Exit Practice
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 md:px-8 py-8 md:py-12">
        {isFinished && (
          <div className="bg-white border-2 border-slate-200 p-8 rounded-xl shadow-sm mb-12 text-center">
            <h2 className="text-2xl font-bold text-blue-950 mb-2">Practice Completed</h2>
            <div className="text-5xl font-extrabold text-amber-500 mb-2 font-serif">
              {Number.isInteger(score) ? score : score.toFixed(2)} <span className="text-2xl text-slate-400">/ {totalMarks}*</span>
            </div>
            <p className="text-sm text-slate-500 font-medium mb-6">
              *Total excluding written questions. <br className="md:hidden" />Review your answers below.
            </p>
            <button
              onClick={handleRetry}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-lg shadow-sm transition-all uppercase tracking-wider text-sm"
            >
              Re-try Practice Test
            </button>
          </div>
        )}

        <div className="space-y-12 mb-12">
          {questions.map((q, index) => {
            const currentAnswer = answers[q.id];
            const isAnswered = currentAnswer !== undefined && currentAnswer !== '[]';
            const showAnswer = showAnswerFor[q.id];
            const isFreeText = q.questionType === 'free_text';
            
            let earned = 0;
            if (isFinished && isAnswered) {
                earned = calculateEarnedMarks(q, currentAnswer);
            }
            const isPerfect = earned === (q.marks || 1);
            const isPartial = earned > 0 && earned < (q.marks || 1);

            return (
              <div key={q.id} className="bg-white border-2 border-slate-200 rounded-xl shadow-sm overflow-hidden" id={`question-${q.id}`}>
                <div className="bg-slate-50 border-b-2 border-slate-200 p-4 px-6 flex justify-between items-center">
                  <h3 className="font-bold text-slate-700 tracking-wide">
                    QUESTION {index + 1}
                  </h3>
                  <div className="flex items-center gap-4">
                      {isFinished && !isFreeText && (
                          <div className={`font-bold px-3 py-1 rounded text-sm ${isPerfect ? 'bg-green-100 text-green-800 border border-green-200' : isPartial ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-red-100 text-red-800 border border-red-200'}`}>
                              {isPerfect ? 'Correct' : isPartial ? `Partial: ${Number.isInteger(earned) ? earned : earned.toFixed(2)}` : 'Incorrect'}
                          </div>
                      )}
                      {isFinished && isFreeText && (
                          <div className="font-bold px-3 py-1 rounded text-sm bg-slate-200 text-slate-700 border border-slate-300">
                              Educator Marked
                          </div>
                      )}
                      <span className="text-sm font-semibold text-slate-500 bg-white border border-slate-300 px-3 py-1 rounded-full shadow-sm">
                        {q.marks} {q.marks === 1 ? 'Mark' : 'Marks'}
                      </span>
                  </div>
                </div>

                <div className="p-6 md:p-8">
                  <div className="prose prose-slate max-w-none text-slate-800 text-lg mb-8 leading-relaxed whitespace-pre-wrap">
                    {q.prompt}
                  </div>
                  {q.imageUrl && (
                    <div className="mb-8 rounded-lg overflow-hidden border border-slate-200 shadow-sm inline-block max-w-full">
                      <img src={q.imageUrl} alt="Question figure" className="max-w-full max-h-[500px] object-contain" />
                    </div>
                  )}

                  <div className="bg-slate-50 rounded-lg p-6 border border-slate-200">
                    {q.questionType === 'free_text' ? (
                      <textarea
                        value={currentAnswer || ''}
                        onChange={(e) => setAnswer(q.id, e.target.value)}
                        className="w-full min-h-[150px] p-4 border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none text-slate-800 resize-y"
                        placeholder="Type your answer here..."
                        disabled={isFinished}
                      />
                    ) : q.questionType === 'single_choice' || q.questionType === 'true_false' ? (
                      <div className="space-y-3">
                        {q.options?.map((opt: string, i: number) => {
                          let isSelected = false;
                          try {
                              isSelected = Array.isArray(JSON.parse(currentAnswer || '[]')) 
                                  ? JSON.parse(currentAnswer || '[]').includes(opt)
                                  : currentAnswer === opt;
                          } catch {
                              isSelected = currentAnswer === opt;
                          }
                          
                          let bgClass = isSelected ? 'bg-blue-50 border-blue-400' : 'bg-white border-slate-300 hover:border-blue-300';
                          if (isFinished && showAnswer) {
                              const strCorrect = typeof q.correctAnswer === 'string' || typeof q.correctAnswer === 'number' || typeof q.correctAnswer === 'boolean' ? String(q.correctAnswer) : '';
                              let correctSelections: string[] = [];
                              try {
                                  const parsed = JSON.parse(strCorrect);
                                  correctSelections = Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
                              } catch {
                                  correctSelections = [strCorrect];
                              }
                              if (Array.isArray(q.correctAnswer)) correctSelections = q.correctAnswer.map(String);
                              else if (typeof q.correctAnswer === 'object' && q.correctAnswer !== null && q.correctAnswer.text !== undefined) correctSelections = [String(q.correctAnswer.text)];

                              const isActuallyCorrect = correctSelections.includes(String(opt));
                              if (isActuallyCorrect) bgClass = 'bg-green-50 border-green-500';
                              else if (isSelected && !isActuallyCorrect) bgClass = 'bg-red-50 border-red-500';
                          }

                          return (
                            <label key={i} className={`flex items-start gap-4 p-4 border-2 rounded-lg cursor-pointer transition-colors ${bgClass} ${isFinished ? 'cursor-default' : ''}`}>
                              <div className="mt-1 shrink-0 flex items-center justify-center">
                                <input
                                  type="radio"
                                  name={`q-${q.id}`}
                                  value={opt}
                                  checked={isSelected}
                                  disabled={isFinished}
                                  onChange={() => setAnswer(q.id, JSON.stringify([opt]))}
                                  className="w-5 h-5 accent-blue-600"
                                />
                              </div>
                              <span className="text-slate-700 font-medium text-lg pt-0.5">{opt}</span>
                            </label>
                          );
                        })}
                      </div>
                    ) : q.questionType === 'multiple_choice' ? (
                      <div className="space-y-3">
                        {q.options?.map((opt: string, i: number) => {
                          let selections: string[] = [];
                          try {
                            selections = JSON.parse(currentAnswer || '[]');
                          } catch {}
                          if (!Array.isArray(selections)) selections = [];
                          
                          const isSelected = selections.includes(opt);
                          
                          let bgClass = isSelected ? 'bg-blue-50 border-blue-400' : 'bg-white border-slate-300 hover:border-blue-300';
                          if (isFinished && showAnswer) {
                              const strCorrect = typeof q.correctAnswer === 'string' || typeof q.correctAnswer === 'number' || typeof q.correctAnswer === 'boolean' ? String(q.correctAnswer) : '';
                              let correctSelections: string[] = [];
                              try {
                                  const parsed = JSON.parse(strCorrect);
                                  correctSelections = Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
                              } catch {
                                  correctSelections = [strCorrect];
                              }
                              if (Array.isArray(q.correctAnswer)) correctSelections = q.correctAnswer.map(String);
                              else if (typeof q.correctAnswer === 'object' && q.correctAnswer !== null && q.correctAnswer.text !== undefined) correctSelections = [String(q.correctAnswer.text)];

                              const isActuallyCorrect = correctSelections.includes(String(opt));
                              if (isActuallyCorrect) bgClass = 'bg-green-50 border-green-500';
                              else if (isSelected && !isActuallyCorrect) bgClass = 'bg-red-50 border-red-500';
                          }

                          return (
                            <label key={i} className={`flex items-start gap-4 p-4 border-2 rounded-lg cursor-pointer transition-colors ${bgClass} ${isFinished ? 'cursor-default' : ''}`}>
                              <div className="mt-1 shrink-0 flex items-center justify-center">
                                <input
                                  type="checkbox"
                                  value={opt}
                                  checked={isSelected}
                                  disabled={isFinished}
                                  onChange={(e) => {
                                    const next = e.target.checked
                                      ? [...selections, opt]
                                      : selections.filter((s) => s !== opt);
                                    setAnswer(q.id, JSON.stringify(next));
                                  }}
                                  className="w-5 h-5 accent-blue-600 rounded"
                                />
                              </div>
                              <span className="text-slate-700 font-medium text-lg pt-0.5">{opt}</span>
                            </label>
                          );
                        })}
                      </div>
                    ) : q.questionType === 'matching' ? (
                      <div className="space-y-4">
                        <div className="bg-blue-50 p-4 rounded-md border border-blue-200 mb-6">
                            <p className="text-sm text-blue-800 font-medium">Select the matching response for each premise below.</p>
                        </div>
                        {q.options?.map((pair: any, i: number) => {
                          let parsed: Record<string, string> = {};
                          try {
                            parsed = JSON.parse(currentAnswer || '{}');
                          } catch {}
                          
                          // Collect all responses for the dropdown options
                          const responseOptions = q.options.map((p: any) => p.response);

                          return (
                            <div key={i} className="flex flex-col md:flex-row md:items-center gap-4 bg-white p-4 border border-slate-200 rounded-lg">
                              <div className="md:w-1/2 font-semibold text-slate-800 text-lg">
                                {pair.premise}
                              </div>
                              <div className="md:w-1/2">
                                <select
                                  disabled={isFinished}
                                  value={parsed[`${q.id}_${i}`] || ''}
                                  onChange={(e) => {
                                    const next = { ...parsed, [`${q.id}_${i}`]: e.target.value };
                                    setAnswer(q.id, JSON.stringify(next));
                                  }}
                                  className={`w-full p-3 border rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none text-slate-800 ${
                                    isFinished && showAnswer
                                      ? parsed[`${q.id}_${i}`] === pair.response
                                        ? 'bg-green-50 border-green-500 text-green-900'
                                        : 'bg-red-50 border-red-500 text-red-900'
                                      : 'bg-slate-50 border-slate-300'
                                  }`}
                                >
                                  <option value="" disabled>Select match...</option>
                                  {responseOptions.map((opt: string, idx: number) => (
                                    <option key={idx} value={opt}>{opt}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-red-500">Unknown question type.</div>
                    )}
                  </div>
                  
                  {/* View Answer button per question */}
                  <div className="mt-6">
                      <button
                          onClick={() => toggleShowAnswer(q.id)}
                          className="text-blue-600 hover:text-blue-800 text-sm font-semibold flex items-center gap-2 transition-colors"
                      >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              {showAnswer ? (
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                              ) : (
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              )}
                              {showAnswer ? (
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              ) : null}
                          </svg>
                          {showAnswer ? 'Hide Correct Answer' : 'Show Correct Answer'}
                      </button>
                      
                      {showAnswer && renderCorrectAnswer(q)}
                  </div>

                </div>
              </div>
            );
          })}
        </div>
      </main>

      {/* Static Footer */}
      {!isFinished && isHydrated && (
        <div className="bg-white border-t-2 border-slate-200 mt-12 p-8">
          <div className="max-w-4xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="text-slate-600 font-medium text-lg">
              Answered: <span className="font-bold text-blue-950">{Object.keys(answers).length}</span> of {questions.length}
            </div>
            <button
              onClick={handleFinish}
              className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-8 rounded-lg shadow-sm transition-all uppercase tracking-wider text-sm"
            >
              Finish & Auto Mark
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
