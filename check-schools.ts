import { db } from './src/lib/db';
import { memberships, submissions } from './src/lib/db/schema';
import { isNull, eq } from 'drizzle-orm';

async function main() {
  const studentsWithoutSchool = await db.select().from(memberships).where(isNull(memberships.schoolId));
  console.log(`Found ${studentsWithoutSchool.length} memberships without a schoolId`);
  
  if (studentsWithoutSchool.length > 0) {
    console.log(studentsWithoutSchool);
  }
  
  process.exit(0);
}

main().catch(console.error);
