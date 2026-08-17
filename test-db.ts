import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
  console.log("Connecting to:", process.env.DATABASE_URL);
  try {
    const queryClient = postgres(process.env.DATABASE_URL as string, { prepare: false });
    const db = drizzle(queryClient);
    
    console.log("Testing connection...");
    const result = await queryClient`SELECT current_database(), current_user`;
    console.log("Connection successful:", result);

    console.log("Testing insert into users...");
    await queryClient`INSERT INTO users (id, email, name, is_platform_admin) VALUES ('835f7a5f-4105-4c81-825d-dd9e4b0aa52c', 'test@test.com', 'test', false) ON CONFLICT DO NOTHING`;
    console.log("Insert successful!");
    
    process.exit(0);
  } catch (err: any) {
    console.error("DB Error detailed:");
    console.error(err);
    process.exit(1);
  }
}

main();
