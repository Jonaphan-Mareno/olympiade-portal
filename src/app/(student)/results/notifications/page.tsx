import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import {
  inAppNotifications,
  memberships,
  rounds,
  submissions,
  results,
  portals,
} from '@/lib/db/schema';
import { eq, and, desc, isNotNull, inArray } from 'drizzle-orm';
import NotificationsClient from './NotificationsClient';

export default async function NotificationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Fetch student's memberships
  const userMemberships = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), eq(memberships.role, 'student')));

  const portalIds = userMemberships.map((m) => m.portalId);
  const membershipIds = userMemberships.map((m) => m.id);

  if (portalIds.length === 0) {
    return (
      <div className="min-h-screen bg-[#F8FAFC]">
        <div className="bg-blue-950 p-8 md:px-12 text-white mb-8">
          <div className="max-w-4xl mx-auto">
            <h1 className="text-3xl font-bold font-serif mb-2">Notifications</h1>
          </div>
        </div>
        <div className="max-w-4xl mx-auto px-4 md:px-8 pb-12">
           <NotificationsClient initialNotifications={[]} />
        </div>
      </div>
    );
  }

  // 1. Fetch persistent notifications
  const persistentNotifs = await db
    .select()
    .from(inAppNotifications)
    .where(eq(inAppNotifications.userId, user.id))
    .orderBy(desc(inAppNotifications.createdAt));

  const allNotifications: any[] = persistentNotifs.map(n => ({
    id: n.id,
    title: n.title,
    message: n.message,
    isRead: n.isRead,
    date: n.createdAt,
    linkUrl: n.linkUrl,
    sender: n.title.toLowerCase().includes('educator') ? 'Educator' : 'System',
    isDynamic: false,
  }));

  const now = new Date();
  
  // Fetch rounds for dynamic notifications
  const portalRounds = await db
    .select({
       round: rounds,
       portalName: portals.name,
    })
    .from(rounds)
    .innerJoin(portals, eq(portals.id, rounds.portalId))
    .where(inArray(rounds.portalId, portalIds));

  portalRounds.forEach(({ round, portalName }) => {
    // a) Olympiad opens soon (within 24 hours)
    const msUntilOpen = round.opensAt.getTime() - now.getTime();
    if (msUntilOpen > 0 && msUntilOpen <= 24 * 60 * 60 * 1000) {
       const hours = Math.ceil(msUntilOpen / (1000 * 60 * 60));
       allNotifications.push({
          id: `dyn_open_${round.id}`,
          title: 'Upcoming Olympiad Round',
          message: `${portalName} - ${round.name} is opening in less than ${hours} hour(s). Get ready!`,
          isRead: false,
          date: new Date(round.opensAt.getTime() - 1000 * 60 * 60), // simulate sent 1 hour before
          linkUrl: '/results/rounds',
          sender: 'Organizer',
          isDynamic: true,
       });
    }

    // b) Marks Released
    if (round.resultsPublishedAt && round.resultsPublishedAt <= now) {
       // Only show if it was published in the last 14 days to avoid clutter
       const daysSince = (now.getTime() - round.resultsPublishedAt.getTime()) / (1000 * 60 * 60 * 24);
       if (daysSince <= 14) {
          allNotifications.push({
             id: `dyn_marks_${round.id}`,
             title: 'Marks Released',
             message: `The results for ${portalName} - ${round.name} have been published. View your marks now!`,
             isRead: false,
             date: round.resultsPublishedAt,
             linkUrl: '/results/past-papers',
             sender: 'Organizer',
             isDynamic: true,
          });
       }
    }

    // c) Dummy logic for Remark Deadline (for future teammate)
    // if (round.remarkDeadline && msUntilRemarkDeadline <= 24 * 60 * 60 * 1000) { ... }
  });

  // d) Remark Updates
  if (membershipIds.length > 0) {
    const studentSubmissions = await db
      .select({
         result: results,
         roundName: rounds.name,
      })
      .from(submissions)
      .innerJoin(results, eq(results.submissionId, submissions.id))
      .innerJoin(rounds, eq(rounds.id, submissions.roundId))
      .where(and(
         inArray(submissions.studentMembershipId, membershipIds),
         eq(results.status, 'remark_resolved')
      ));

    studentSubmissions.forEach(({ result, roundName }) => {
       allNotifications.push({
          id: `dyn_remark_${result.id}`,
          title: 'Remark Resolved',
          message: `Your remark request for ${roundName} has been processed. Outcome: ${result.remarkOutcome}`,
          isRead: false,
          date: now, // Ideally we'd have an updatedAt on results table, but now fallback
          linkUrl: '/results/past-papers',
          sender: 'Educator',
          isDynamic: true,
       });
    });
  }

  // Sort all notifications by date desc
  allNotifications.sort((a, b) => b.date.getTime() - a.date.getTime());

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <div className="bg-blue-950 p-8 md:px-12 text-white mb-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold font-serif mb-2">Notifications</h1>
          <p className="text-blue-200">Stay up to date with your Olympiads.</p>
        </div>
      </div>
      
      <div className="max-w-4xl mx-auto px-4 md:px-8 pb-12">
        <NotificationsClient initialNotifications={allNotifications} />
      </div>
    </div>
  );
}
