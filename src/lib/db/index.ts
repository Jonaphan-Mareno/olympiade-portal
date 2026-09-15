import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString =
  !process.env.DATABASE_URL || process.env.DATABASE_URL === '[SENSITIVE]'
    ? 'postgres://dummy:dummy@dummy:5432/dummy'
    : process.env.DATABASE_URL;

const queryClient = postgres(connectionString, {
  prepare: false,
});
export const db = drizzle(queryClient, { schema });
