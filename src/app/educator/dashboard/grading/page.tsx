import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { submissions, memberships, users, rounds, questions } from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import Link from 'next/link';

export default async function GradingDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Get educator memberships
  const educatorMemberships = await db
    .select()
    .from(memberships)
    .where(eq(memberships.userId, user.id));

  // In a real app we'd filter submissions by schoolId or portalId that the educator has access to.
  // For the MVP scaffold, we'll fetch all submitted tests.
  
  const allSubmissions = await db
    .select({
      id: submissions.id,
      status: submissions.status,
      submittedAt: submissions.submittedAt,
      roundId: submissions.roundId,
      studentId: submissions.studentMembershipId,
    })
    .from(submissions)
    .where(eq(submissions.status, 'submitted'));

  // Dummy data mapping for the scaffold
  const testData = allSubmissions.map(sub => ({
    id: sub.id,
    studentName: 'Student ' + sub.studentId?.substring(0,4), // Replace with actual join
    roundName: 'Round ' + sub.roundId?.substring(0,4), // Replace with actual join
    status: Math.random() > 0.5 ? 'Requires Manual Grading' : 'Auto-Graded', // Dummy flag logic
    score: Math.random() > 0.5 ? 'Pending' : '85%',
    submittedAt: sub.submittedAt ? new Date(sub.submittedAt).toLocaleDateString() : 'N/A'
  }));

  // Add some fake data if DB is empty for UI scaffolding
  if (testData.length === 0) {
    testData.push(
      { id: '1', studentName: 'Alice Smith', roundName: 'Qualifying Round', status: 'Requires Manual Grading', score: 'Pending', submittedAt: '2026-09-12' },
      { id: '2', studentName: 'Bob Jones', roundName: 'Qualifying Round', status: 'Auto-Graded', score: '18/20', submittedAt: '2026-09-12' },
      { id: '3', studentName: 'Charlie Brown', roundName: 'Finals', status: 'Requires Manual Grading', score: 'Pending', submittedAt: '2026-09-13' }
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6 font-sans">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-serif font-bold text-slate-800 mb-2">Grading Dashboard</h1>
        <p className="text-slate-600 mb-8">Review and grade submissions from your students.</p>

        <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 text-sm">
                <th className="p-4 font-semibold">Student Name</th>
                <th className="p-4 font-semibold">Round</th>
                <th className="p-4 font-semibold">Submitted</th>
                <th className="p-4 font-semibold">Status</th>
                <th className="p-4 font-semibold">Score</th>
                <th className="p-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {testData.map((test, i) => (
                <tr key={test.id} className={`border-b border-slate-100 hover:bg-slate-50 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                  <td className="p-4 text-slate-800 font-medium">{test.studentName}</td>
                  <td className="p-4 text-slate-600">{test.roundName}</td>
                  <td className="p-4 text-slate-600 text-sm">{test.submittedAt}</td>
                  <td className="p-4">
                    <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                      test.status === 'Requires Manual Grading' 
                        ? 'bg-amber-100 text-amber-800 border border-amber-200' 
                        : 'bg-green-100 text-green-800 border border-green-200'
                    }`}>
                      {test.status}
                    </span>
                  </td>
                  <td className="p-4 text-slate-700 font-medium">{test.score}</td>
                  <td className="p-4 text-right">
                    <Link href={`/educator/dashboard/grading/${test.id}`}>
                      <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-md text-sm transition-colors shadow-sm">
                        {test.status === 'Requires Manual Grading' ? 'Grade Now' : 'Review'}
                      </button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          
          {testData.length === 0 && (
            <div className="p-8 text-center text-slate-500">
              No submissions found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
