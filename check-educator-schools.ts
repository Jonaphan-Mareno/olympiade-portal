import { config } from 'dotenv';
config({ path: '.env.local' });
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { users, memberships, schools, portals } from './src/lib/db/schema';
import { eq, and } from 'drizzle-orm';

const connectionString = process.env.DATABASE_URL!;
const queryClient = postgres(connectionString, { prepare: false });
const db = drizzle(queryClient);

async function main() {
  const userRes = await db.select().from(users).where(eq(users.email, 'jonteacher@gmail.com'));
  if (!userRes.length) {
    console.log('No user jonteacher');
    process.exit(1);
  }
  const userId = userRes[0].id;

  const mRes = await db.select({
    schoolName: schools.name,
    schoolId: schools.id,
    portalName: portals.name,
    portalId: portals.id,
  })
  .from(memberships)
  .leftJoin(schools, eq(memberships.schoolId, schools.id))
  .leftJoin(portals, eq(memberships.portalId, portals.id))
  .where(and(eq(memberships.userId, userId), eq(memberships.role, 'educator')));

  console.log(mRes);
  process.exit(0);
}

main().catch(console.error);
