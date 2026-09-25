import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { inAppNotifications } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function EducatorNotificationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const notifications = await db
    .select()
    .from(inAppNotifications)
    .where(eq(inAppNotifications.userId, user.id))
    .orderBy(desc(inAppNotifications.createdAt));

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <div className="bg-blue-900 border-b border-blue-800 p-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-serif font-bold text-white mb-1">
            Notifications
          </h1>
          <p className="text-blue-200 text-sm m-0">
            Updates and alerts for your school.
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 md:px-8 py-8">
        <div className="bg-white border-2 border-slate-200 rounded-md shadow-sm">
          {notifications.length === 0 ? (
            <div className="p-8 text-center text-slate-500 font-medium">
              You currently have no notifications.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {notifications.map((n) => (
                <li key={n.id} className={`p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 ${!n.isRead ? 'bg-blue-50/50' : 'bg-white'}`}>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {!n.isRead && (
                        <span className="w-2 h-2 rounded-full bg-blue-600"></span>
                      )}
                      <h3 className={`text-base font-semibold ${!n.isRead ? 'text-slate-900' : 'text-slate-700'}`}>
                        {n.title}
                      </h3>
                    </div>
                    <p className={`text-sm ${!n.isRead ? 'text-slate-700 font-medium' : 'text-slate-600'}`}>
                      {n.message}
                    </p>
                    <div className="mt-2 text-xs text-slate-400">
                      {new Date(n.createdAt).toLocaleString(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short'
                      })}
                    </div>
                  </div>
                  {n.linkUrl && (
                    <div className="shrink-0">
                      <Link href={n.linkUrl} className="inline-block px-4 py-2 border border-slate-300 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
                        View Details
                      </Link>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
