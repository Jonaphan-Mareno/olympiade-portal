import { db } from '@/lib/db';
import { memberships, portals, rounds, schools, users } from '@/lib/db/schema';
import { and, count, eq, inArray } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import DeletePortalButton from './DeletePortalButton';
import AddEducatorButton from './AddEducatorButton';
import { deriveRoundState } from '@/domain/rounds/round-state-machine';

export default async function OlympiadDetailsPage({
  params,
}: {
  params: Promise<{ olympiadId: string }>;
}) {
  const resolvedParams = await params;
  const portalId = resolvedParams.olympiadId;

  const [portal] = await db
    .select()
    .from(portals)
    .where(eq(portals.id, portalId));

  if (!portal) {
    redirect('/organiser/dashboard');
  }

  // 2. Fetch all rounds associated with this Olympiad, ordered by their orderIndex
  const existingRounds = await db
    .select()
    .from(rounds)
    .where(eq(rounds.portalId, portalId))
    .orderBy(rounds.orderIndex);

  const now = new Date();
  const hasStartedRounds = existingRounds.some((round) => {
    return deriveRoundState(round, now) !== 'scheduled';
  });

  // 3. Fetch all participating schools
  const existingSchools = await db
    .select()
    .from(schools)
    .where(eq(schools.portalId, portalId))
    .orderBy(schools.createdAt);

  // 3b. Each school's educators (with their account name once claimed) and
  // student totals, so the list below shows who is actually participating
  const schoolIds = existingSchools.map((s) => s.id);

  const educatorMemberships =
    schoolIds.length > 0
      ? await db
          .select({
            id: memberships.id,
            schoolId: memberships.schoolId,
            status: memberships.status,
            invitedEmail: memberships.invitedEmail,
            userName: users.name,
          })
          .from(memberships)
          .leftJoin(users, eq(memberships.userId, users.id))
          .where(
            and(
              inArray(memberships.schoolId, schoolIds),
              eq(memberships.portalId, portalId),
              eq(memberships.role, 'educator')
            )
          )
      : [];

  const studentCountRows =
    schoolIds.length > 0
      ? await db
          .select({ schoolId: memberships.schoolId, total: count() })
          .from(memberships)
          .where(
            and(
              inArray(memberships.schoolId, schoolIds),
              eq(memberships.portalId, portalId),
              eq(memberships.role, 'student')
            )
          )
          .groupBy(memberships.schoolId)
      : [];

  const educatorsBySchool = new Map<
    string,
    (typeof educatorMemberships)[number][]
  >();
  for (const educator of educatorMemberships) {
    if (!educator.schoolId) continue;
    const list = educatorsBySchool.get(educator.schoolId) ?? [];
    list.push(educator);
    educatorsBySchool.set(educator.schoolId, list);
  }

  const studentsBySchool = new Map<string, number>();
  for (const row of studentCountRows) {
    if (row.schoolId) studentsBySchool.set(row.schoolId, row.total);
  }

  return (
    <div className="min-h-screen bg-white font-sans">
      {/* Wave Wash Header Section */}
      <div className="relative w-full overflow-hidden bg-gradient-to-b from-blue-50/80 to-white py-12 px-4 md:px-8 border-b border-slate-100">
        {/* Decorative Glassy Orbs - Left Cluster */}
        <div className="pointer-events-none absolute top-2 left-[2%] w-24 h-24 rounded-full bg-gradient-to-br from-blue-400 to-blue-700 opacity-80 backdrop-blur-xl border-t border-l border-white/60 shadow-[0_10px_25px_rgba(0,0,0,0.1),inset_-8px_-8px_12px_rgba(0,0,0,0.2),inset_8px_8px_12px_rgba(255,255,255,0.4)] z-0" />
        <div className="pointer-events-none absolute top-12 left-[8%] w-16 h-16 rounded-full bg-gradient-to-br from-cyan-300 to-blue-500 opacity-70 backdrop-blur-xl border-t border-l border-white/60 shadow-[0_10px_25px_rgba(0,0,0,0.1),inset_-8px_-8px_12px_rgba(0,0,0,0.2),inset_8px_8px_12px_rgba(255,255,255,0.4)] z-0" />
        <div className="pointer-events-none absolute top-24 left-[5%] w-12 h-12 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 opacity-80 backdrop-blur-xl border-t border-l border-white/60 shadow-[0_10px_25px_rgba(0,0,0,0.1),inset_-8px_-8px_12px_rgba(0,0,0,0.2),inset_8px_8px_12px_rgba(255,255,255,0.4)] z-0" />

        {/* Decorative Glassy Orbs - Right Cluster */}
        <div className="pointer-events-none absolute top-8 right-[25%] w-16 h-16 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 opacity-70 backdrop-blur-xl border-t border-l border-white/60 shadow-[0_10px_25px_rgba(0,0,0,0.1),inset_-8px_-8px_12px_rgba(0,0,0,0.2),inset_8px_8px_12px_rgba(255,255,255,0.4)] z-0" />
        <div className="pointer-events-none absolute top-4 right-[15%] w-20 h-20 rounded-full bg-gradient-to-br from-cyan-300 to-blue-500 opacity-80 backdrop-blur-xl border-t border-l border-white/60 shadow-[0_10px_25px_rgba(0,0,0,0.1),inset_-8px_-8px_12px_rgba(0,0,0,0.2),inset_8px_8px_12px_rgba(255,255,255,0.4)] z-0" />
        <div className="pointer-events-none absolute top-16 right-[5%] w-32 h-32 rounded-full bg-gradient-to-br from-blue-400 to-blue-700 opacity-80 backdrop-blur-xl border-t border-l border-white/60 shadow-[0_10px_25px_rgba(0,0,0,0.1),inset_-8px_-8px_12px_rgba(0,0,0,0.2),inset_8px_8px_12px_rgba(255,255,255,0.4)] z-0" />

        <div className="relative z-10 max-w-4xl mx-auto">
          <h1 className="font-serif text-5xl font-bold text-slate-900 capitalize m-0">
            {portal.name}
          </h1>
          <p className="text-slate-500 mt-2 text-lg">
            Manage your rounds, question banks, and automations here.
          </p>
        </div>
      </div>

      <div className="w-full px-4 md:px-8 pt-8">
        <div className="max-w-4xl mx-auto">
          {/* Rounds Management Section (Syllabus Layout) */}
          <div className="mb-8">
            <div className="flex flex-row justify-between items-center bg-blue-900 p-4 px-6 rounded-md mb-6">
              <h2 className="font-serif text-2xl font-bold text-white m-0">
                Competition Rounds
              </h2>

              <Link
                href={`/organiser/olympiads/${portalId}/rounds/create`}
                className="bg-white text-slate-900 px-5 py-2.5 rounded-md no-underline text-sm font-semibold transition-colors hover:bg-slate-200 hover:text-slate-900"
              >
                + Create New Round
              </Link>
            </div>

            {/* List existing rounds or show empty state */}
            {existingRounds.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-slate-300 rounded-lg">
                <p className="text-slate-500 mb-0">
                  No rounds have been created for this Olympiad yet.
                </p>
              </div>
            ) : (
              <div className="flex flex-col">
                {existingRounds.map((round, idx) => {
                  const state = deriveRoundState(round);
                  return (
                    <div
                      key={round.id}
                      className={`flex flex-row justify-between items-center py-6 px-8 md:px-10 border-b border-slate-200 rounded-none ${
                        idx % 2 === 0 ? 'bg-blue-50/50' : 'bg-blue-900/5'
                      }`}
                    >
                      <div>
                        <h3 className="font-serif text-xl font-bold text-slate-900 m-0 mb-1">
                          Round {round.orderIndex}: {round.name}{' '}
                          <span
                            style={{
                              display: 'inline-block',
                              fontSize: '0.7rem',
                              fontWeight: 600,
                              padding: '0.15rem 0.6rem',
                              borderRadius: '9999px',
                              verticalAlign: 'middle',
                            }}
                            className={
                              state === 'scheduled'
                                ? 'bg-slate-100 text-slate-700'
                                : state === 'open'
                                  ? 'bg-green-100 text-green-800'
                                  : state === 'closed'
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-blue-100 text-blue-800'
                            }
                          >
                            {state}
                          </span>
                        </h3>
                        <p className="text-sm text-slate-600 m-0">
                          Opens: {round.opensAt.toLocaleString()} | Closes:{' '}
                          {round.closesAt.toLocaleString()}
                        </p>
                      </div>
                      <Link
                        href={`/organiser/olympiads/${portalId}/rounds/${round.id}`}
                        className="text-slate-900 no-underline text-sm font-semibold hover:text-blue-600 transition-colors"
                      >
                        Manage &rarr;
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Participating Schools Section */}
          <div className="mb-12">
            <div className="flex flex-row justify-between items-center bg-blue-900 p-4 px-6 rounded-md mb-6">
              <h2 className="font-serif text-2xl font-bold text-white m-0">
                Participating Schools
              </h2>

              <Link
                href={`/organiser/olympiads/${portalId}/invite`}
                className="bg-white text-slate-900 px-5 py-2.5 rounded-md no-underline text-sm font-semibold transition-colors hover:bg-slate-100 hover:text-slate-900"
              >
                + Invite School
              </Link>
            </div>

            {existingSchools.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-slate-300 rounded-lg">
                <p className="text-slate-500 mb-0">
                  No schools have been invited yet.
                </p>
              </div>
            ) : (
              <div className="flex flex-col">
                {existingSchools.map((school, idx) => {
                  const educators = educatorsBySchool.get(school.id) ?? [];
                  const studentTotal = studentsBySchool.get(school.id) ?? 0;
                  return (
                    <div
                      key={school.id}
                      className={`flex flex-row justify-between items-center py-6 px-8 md:px-10 border-b border-slate-200 rounded-none ${
                        idx % 2 === 0 ? 'bg-blue-50/50' : 'bg-slate-900/5'
                      }`}
                    >
                      <div className="min-w-0">
                        <h3 className="font-serif text-xl font-bold text-slate-900 m-0 mb-2">
                          {school.name}
                        </h3>

                        {/* Educators invited for this school */}
                        <div className="flex flex-wrap gap-2 mb-2">
                          {educators.length === 0 ? (
                            <span className="text-sm text-slate-500 italic">
                              No educator linked yet
                            </span>
                          ) : (
                            educators.map((educator) => (
                              <span
                                key={educator.id}
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-sm ${
                                  educator.status === 'accepted'
                                    ? 'bg-green-50 border-green-200 text-green-800'
                                    : 'bg-slate-50 border-slate-200 text-slate-600'
                                }`}
                              >
                                {educator.invitedEmail}
                                {educator.userName &&
                                  educator.userName !==
                                    educator.invitedEmail && (
                                    <span className="text-xs text-slate-400">
                                      {educator.userName}
                                    </span>
                                  )}
                                {educator.status !== 'accepted' && (
                                  <span className="text-[0.65rem] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                                    pending
                                  </span>
                                )}
                              </span>
                            ))
                          )}
                        </div>

                        <p className="text-xs text-slate-500 m-0">
                          Added:{' '}
                          {school.createdAt
                            ? school.createdAt.toLocaleDateString()
                            : 'Unknown'}
                        </p>
                      </div>

                      {/* Student head-count and educator management for
                          this school */}
                      <div className="flex items-center gap-4 shrink-0 ml-6">
                        <div className="text-right">
                          <span className="font-serif text-2xl font-bold text-slate-900">
                            {studentTotal}
                          </span>
                          <span className="block text-xs text-slate-500 uppercase tracking-wide">
                            student{studentTotal === 1 ? '' : 's'}
                          </span>
                        </div>
                        <AddEducatorButton
                          portalId={portalId}
                          schoolId={school.id}
                          schoolName={school.name}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {!hasStartedRounds && (
            <div className="flex justify-start mt-16 mb-8">
              <DeletePortalButton portalId={portalId} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
