import { config } from 'dotenv';
config({ path: '.env.local' });
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { users, portals } from './src/lib/db/schema';
import { eq } from 'drizzle-orm';

const connectionString = process.env.DATABASE_URL!;
const queryClient = postgres(connectionString, { prepare: false });
const db = drizzle(queryClient);

async function main() {
  const allPortals = await db.select({ portalName: portals.name, ownerEmail: users.email })
    .from(portals)
    .leftJoin(users, eq(portals.ownerUserId, users.id));
  console.log(allPortals);
  process.exit(0);
}

main().catch(console.error);
