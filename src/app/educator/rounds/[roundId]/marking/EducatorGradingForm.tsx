'use client';

import { useState } from 'react';
import { submitMarksForModeration } from './actions';

export default function EducatorGradingForm({
  roundId,
  submission,
  questions,
  initialGrades,
  memoText,
  memoUrl,
}: {
  roundId: string;
  submission: any;
  questions: any[];
  initialGrades?: { questionId: string; score: number; feedback: string }[];
  memoText?: string;
  memoUrl?: string;
}) {
  const [grades, setGrades] = useState<Record<string, { score: number; feedback: string }>>(() => {
    const initialState: Record<string, { score: number; feedback: string }> = {};
    if (initialGrades && initialGrades.length > 0) {
      initialGrades.forEach((g) => {
        initialState[g.questionId] = { score: g.score, feedback: g.feedback };
      });
    } else {
      questions.forEach((q) => {
        initialState[q.id] = { score: 0, feedback: '' };
      });
    }
    return initialState;
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleScoreChange = (questionId: string, maxMarks: number, value: string) => {
    let score = parseFloat(value);
    if (isNaN(score)) score = 0;
    if (score < 0) score = 0;
    if (score > maxMarks) score = maxMarks;

    setGrades((prev) => ({
      ...prev,
      [questionId]: { ...prev[questionId], score },
    }));
    setError(null);
    setSuccess(false);
  };

  const handleFeedbackChange = (questionId: string, value: string) => {
    setGrades((prev) => ({
      ...prev,
      [questionId]: { ...prev[questionId], feedback: value },
    }));
    setError(null);
    setSuccess(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setSuccess(false);

    const gradesArray = Object.entries(grades).map(([questionId, data]) => ({
      questionId,
      score: data.score,
      feedback: data.feedback,
    }));

    const result = await submitMarksForModeration(roundId, submission.id, gradesArray);

    setIsSubmitting(false);

    if (result.error) {
      setError(result.error);
    } else {
      setSuccess(true);
    }
  };

  const getStudentAnswer = (questionId: string) => {
    if (submission.submissionType === 'online' && submission.answersJson) {
      const answer = (submission.answersJson as any[]).find(a => a.questionId === questionId);
      return answer ? answer.answerValue : 'No answer provided.';
    }
    return null;
  };

  return (
    <div className="flex flex-col md:flex-row gap-8 w-full h-[calc(100vh-14rem)]">
      {/* Left Pane: Memo & Student Submission Context */}
      <div className="flex-1 flex flex-col gap-6">
        
        {memoUrl ? (
          <div className="bg-white border border-slate-200 rounded-md overflow-hidden flex flex-col min-h-[400px]">
            <div className="p-3 bg-slate-50 border-b border-slate-200 shrink-0">
              <h3 className="font-semibold text-slate-900 m-0">Official Memo / Rubric</h3>
            </div>
            <iframe 
              src={memoUrl} 
              className="w-full h-full min-h-[600px] border-0" 
              title="Official Memo PDF"
            />
          </div>
        ) : memoText && (
          <div className="bg-white border border-slate-200 rounded-md overflow-hidden flex flex-col shrink-0">
            <div className="p-3 bg-slate-50 border-b border-slate-200 shrink-0">
              <h3 className="font-semibold text-slate-900 m-0">Official Memo / Rubric</h3>
            </div>
            <div className="p-4 max-h-48 overflow-auto text-sm text-slate-700 whitespace-pre-wrap">
              {memoText}
            </div>
          </div>
        )}

        {submission.submissionType === 'online' && (
          <div className="flex-1 border border-slate-200 bg-slate-50 overflow-hidden flex flex-col rounded-md min-h-0">
            <div className="p-4 bg-white border-b border-slate-200 shrink-0">
              <h3 className="font-semibold text-slate-900 m-0">Student Submission</h3>
              <p className="text-sm text-slate-500 m-0">{submission.studentName}</p>
            </div>
            
            <div className="flex-1 overflow-auto p-4">
              <div className="space-y-6">
                {questions.map((q, idx) => (
                  <div key={`context-${q.id}`} className="bg-white p-4 border border-slate-200 rounded-md">
                    <p className="font-semibold text-slate-900 mb-2">Q{idx + 1}: {q.prompt}</p>
                    <div className="bg-slate-50 p-3 border border-slate-200 rounded text-slate-700 whitespace-pre-wrap">
                      {getStudentAnswer(q.id) || <span className="text-slate-400 italic">No answer mapped from online state</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right Pane: Grading Form */}
      <div className="w-full md:w-96 flex-shrink-0 bg-white border border-slate-200 rounded-md overflow-hidden flex flex-col">
        <div className="p-4 bg-blue-900 border-b border-slate-200 shrink-0">
          <h3 className="font-semibold text-white m-0">Grading & Feedback</h3>
        </div>
        
        <div className="flex-1 overflow-auto p-4">
          <form onSubmit={handleSubmit} className="space-y-6">
            {questions.map((q, idx) => (
              <div key={`grade-${q.id}`} className="pb-6 border-b border-slate-100 last:border-0 last:pb-0">
                <div className="flex justify-between items-center mb-2">
                  <label className="font-medium text-slate-700">Question {idx + 1}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max={q.marks}
                      value={grades[q.id]?.score ?? 0}
                      onChange={(e) => handleScoreChange(q.id, q.marks, e.target.value)}
                      className="w-16 px-2 py-1 text-right border border-slate-300 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                    <span className="text-slate-500 text-sm">/ {q.marks} marks</span>
                  </div>
                </div>
                
                <textarea
                  placeholder="Grading Reason / Feedback..."
                  value={grades[q.id]?.feedback ?? ''}
                  onChange={(e) => handleFeedbackChange(q.id, e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm h-20 resize-y"
                />
              </div>
            ))}

            {error && (
              <div className="p-3 bg-red-50 text-red-700 text-sm rounded border border-red-200">
                {error}
              </div>
            )}
            
            {success && (
              <div className="p-3 bg-green-50 text-green-700 text-sm rounded border border-green-200">
                Marks submitted for moderation!
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md transition-colors disabled:opacity-50"
            >
              {isSubmitting ? 'Saving...' : 'Submit Marks for Moderation'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
