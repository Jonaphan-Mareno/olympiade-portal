import { config } from 'dotenv';
config({ path: '.env.local' });
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { users, memberships, portals } from './src/lib/db/schema';
import { eq } from 'drizzle-orm';

const connectionString = process.env.DATABASE_URL!;
const queryClient = postgres(connectionString, { prepare: false });
const db = drizzle(queryClient);

async function main() {
  const educators = await db.select({ email: users.email, role: memberships.role, schoolId: memberships.schoolId })
    .from(users)
    .leftJoin(memberships, eq(users.id, memberships.userId));
  console.log(educators);
  process.exit(0);
}

main().catch(console.error);
