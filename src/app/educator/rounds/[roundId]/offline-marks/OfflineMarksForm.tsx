'use client';

import { useState } from 'react';
import { submitBulkOfflineMarks } from './actions';
import { useRouter } from 'next/navigation';

export default function OfflineMarksForm({
  roundId,
  students,
  maxMarks
}: {
  roundId: string;
  students: any[];
  maxMarks: number;
}) {
  const router = useRouter();
  
  // State to hold { studentMembershipId: score }
  const [marks, setMarks] = useState<Record<string, string>>(() => {
    const initialState: Record<string, string> = {};
    students.forEach(s => {
      if (s.existingScore !== null && s.existingScore !== undefined) {
        initialState[s.membershipId] = s.existingScore.toString();
      } else {
        initialState[s.membershipId] = '';
      }
    });
    return initialState;
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleScoreChange = (membershipId: string, value: string) => {
    let newScore: string = value;
    if (value !== '') {
      const parsed = parseFloat(value);
      if (!isNaN(parsed)) {
        if (parsed < 0) newScore = '0';
        if (parsed > maxMarks) newScore = maxMarks.toString();
      }
    }

    setMarks(prev => ({
      ...prev,
      [membershipId]: newScore
    }));
    setError(null);
    setSuccess(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setSuccess(false);

    const marksData = Object.entries(marks)
      .filter(([_, score]) => score !== '')
      .map(([membershipId, score]) => ({
        studentMembershipId: membershipId,
        score: parseFloat(score)
      }));

    if (marksData.length === 0) {
      setError("Please enter at least one score before submitting.");
      setIsSubmitting(false);
      return;
    }

    const result = await submitBulkOfflineMarks(roundId, marksData);

    setIsSubmitting(false);

    if (result.error) {
      setError(result.error);
    } else {
      setSuccess(true);
      router.refresh();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-white border-2 border-slate-200 rounded-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b-2 border-slate-200">
            <tr>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Student Name</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Email</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider w-48">Score</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {students.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-6 py-8 text-center text-slate-500 italic">
                  No eligible students found for offline grading.
                </td>
              </tr>
            ) : (
              students.map(student => (
                <tr key={student.membershipId} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 font-medium text-slate-900">{student.name}</td>
                  <td className="px-6 py-4 text-slate-600">{student.email}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        step="0.25"
                        min="0"
                        max={maxMarks}
                        value={marks[student.membershipId] ?? ''}
                        onChange={(e) => handleScoreChange(student.membershipId, e.target.value)}
                        className="w-20 px-3 py-2 border-2 border-slate-300 rounded-none focus:border-blue-900 focus:ring-0 font-medium text-center"
                        placeholder="--"
                      />
                      <span className="text-slate-400 font-bold text-sm">/ {maxMarks}</span>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-slate-50 border-2 border-slate-200 p-6 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="w-full md:w-auto">
          {error && (
            <div className="px-4 py-2 bg-red-50 text-red-700 font-bold text-sm border-2 border-red-200 rounded-none">
              {error}
            </div>
          )}
          {success && (
            <div className="px-4 py-2 bg-green-50 text-green-700 font-bold text-sm border-2 border-green-200 rounded-none">
              Marks successfully saved!
            </div>
          )}
        </div>
        
        <button
          type="submit"
          disabled={isSubmitting || students.length === 0}
          className="w-full md:w-auto bg-amber-400 hover:bg-amber-500 disabled:bg-slate-300 disabled:border-slate-400 text-amber-950 font-bold py-3 px-8 transition-colors text-center uppercase tracking-wider rounded-none border-2 border-amber-500 shrink-0"
        >
          {isSubmitting ? 'Saving...' : 'Save All Marks'}
        </button>
      </div>
    </form>
  );
}
