import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// for query purposes, disabling prepare for Supabase pooler compatibility
const queryClient = postgres(process.env.DATABASE_URL as string, { prepare: false });
export const db = drizzle(queryClient, { schema });
