'use client';

import { useState } from 'react';
import { submitMarksForModeration } from './actions';
import { useRouter } from 'next/navigation';

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
  const [grades, setGrades] = useState<Record<string, { score: number | string; feedback: string }>>(() => {
    const initialState: Record<string, { score: number | string; feedback: string }> = {};
    if (initialGrades && initialGrades.length > 0) {
      initialGrades.forEach((g) => {
        initialState[g.questionId] = { score: g.score, feedback: g.feedback };
      });
    } else {
      questions.forEach((q) => {
        initialState[q.id] = { score: '', feedback: '' };
      });
    }
    return initialState;
  });

  const router = useRouter();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleScoreChange = (questionId: string, maxMarks: number, value: string) => {
    let newScore: number | string = value;
    
    if (value !== '') {
      const parsed = parseFloat(value);
      if (!isNaN(parsed)) {
        if (parsed < 0) newScore = 0;
        if (parsed > maxMarks) newScore = maxMarks;
      }
    }

    setGrades((prev) => ({
      ...prev,
      [questionId]: { ...prev[questionId], score: newScore },
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
      score: parseFloat(data.score as string) || 0,
      feedback: data.feedback,
    }));

    const result = await submitMarksForModeration(roundId, submission.id, gradesArray);

    setIsSubmitting(false);

    if (result.error) {
      setError(result.error);
    } else {
      setSuccess(true);
      router.refresh();
    }
  };

  const getStudentAnswer = (questionId: string) => {
    if (submission.submissionType === 'online' && submission.answersJson) {
      const answers = submission.answersJson as Record<string, string>;
      return answers[questionId] || 'No answer provided.';
    }
    return 'Offline submission (see uploaded paper).';
  };

  const formatAnswerKey = (correctAnswer: any) => {
    if (!correctAnswer) return 'No specific key provided.';
    if (typeof correctAnswer === 'string') return correctAnswer;
    if (typeof correctAnswer === 'object') {
      if (correctAnswer.memo) return correctAnswer.memo;
      if (correctAnswer.text) return correctAnswer.text;
      return JSON.stringify(correctAnswer, null, 2);
    }
    return String(correctAnswer);
  };

  return (
    <div className="w-full">
      <div className="mb-6 bg-slate-50 border-2 border-slate-200 p-6 rounded-none flex justify-between items-center">
        <div>
           <h2 className="text-xl font-bold text-blue-950">Grading Submission</h2>
           <p className="text-slate-600 font-medium">{submission.studentName || submission.invitedEmail}</p>
        </div>
        <div className="text-right">
           <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Total Manual Questions</p>
           <p className="text-2xl font-bold text-blue-950">{questions.length}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {questions.map((q, idx) => (
          <div key={q.id} className="bg-white border-2 border-slate-200 rounded-none shadow-none flex flex-col">
            {/* Card Header */}
            <div className="bg-blue-950 p-4 flex justify-between items-center">
              <h3 className="text-white font-bold uppercase tracking-wider text-sm">Question {q.originalIndex || (idx + 1)}</h3>
              <span className="text-amber-400 font-bold uppercase tracking-wider text-sm">{q.marks} Marks Available</span>
            </div>
            
            {/* Card Body */}
            <div className="p-6 flex flex-col gap-6">
              <div>
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Question Prompt</h4>
                <p className="text-slate-900 text-lg font-medium">{q.prompt}</p>
              </div>
              
              <div className="flex flex-col md:flex-row gap-6">
                <div className="flex-1 bg-slate-50 border-2 border-slate-200 p-5 rounded-none">
                  <h4 className="text-xs font-bold text-blue-950 uppercase tracking-wider mb-3">Student's Answer</h4>
                  <p className="text-slate-800 whitespace-pre-wrap font-medium">{getStudentAnswer(q.id)}</p>
                </div>
                
                <div className="flex-1 bg-green-50 border-2 border-green-200 p-5 rounded-none">
                  <h4 className="text-xs font-bold text-green-900 uppercase tracking-wider mb-3">Official Answer Key</h4>
                  <p className="text-green-900 whitespace-pre-wrap">{formatAnswerKey(q.correctAnswer)}</p>
                </div>
              </div>
              
              <div className="border-t-2 border-slate-100 pt-6 mt-2 flex flex-col md:flex-row gap-6 items-start">
                <div className="flex-1 w-full">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Educator Feedback (Optional)</label>
                  <textarea
                    placeholder="Provide constructive feedback..."
                    value={grades[q.id]?.feedback ?? ''}
                    onChange={(e) => handleFeedbackChange(q.id, e.target.value)}
                    className="w-full px-4 py-3 border-2 border-slate-300 rounded-none focus:border-blue-950 focus:ring-0 text-slate-700 h-24 resize-y"
                  />
                </div>
                
                <div className="w-full md:w-64 flex flex-col md:items-end shrink-0">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Award Marks</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      step="0.25"
                      min="0"
                      max={q.marks}
                      value={grades[q.id]?.score ?? ''}
                      onChange={(e) => handleScoreChange(q.id, q.marks, e.target.value)}
                      className="w-24 px-4 py-3 border-2 border-blue-950 rounded-none text-xl font-bold text-center text-blue-950 focus:ring-0 focus:outline-none"
                    />
                    <span className="text-slate-500 font-bold text-lg">/ {q.marks}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}

        <div className="bg-slate-50 border-2 border-slate-200 p-6 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="w-full md:w-auto">
            {error && (
              <div className="px-4 py-2 bg-red-50 text-red-700 font-bold text-sm border-2 border-red-200 rounded-none">
                {error}
              </div>
            )}
            {success && (
              <div 
                className="pl-6 pr-8 py-3 bg-green-600 text-white font-bold text-sm shadow-sm"
                style={{ clipPath: 'polygon(0 0, calc(100% - 16px) 0, 100% 50%, calc(100% - 16px) 100%, 0 100%)', marginLeft: '-24px' }}
              >
                Marks successfully submitted for moderation!
              </div>
            )}
          </div>
          
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full md:w-auto bg-amber-400 hover:bg-amber-500 disabled:bg-slate-300 disabled:border-slate-400 text-amber-950 font-bold py-4 px-10 transition-colors text-center uppercase tracking-wider rounded-none border-2 border-amber-500 shrink-0"
          >
            {isSubmitting ? 'Saving...' : (success || (submission.resultStatus === 'moderated' || submission.resultStatus === 'remark_requested') ? 'Remark' : 'Submit Final Grades')}
          </button>
        </div>
      </form>
    </div>
  );
}
