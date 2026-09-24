import { publicJson } from '@/app/api/public/_shared';
import { listPublicSchools } from '@/domain/public-api/queries';

// Public (no auth): the schools participating in any portal, as a flat
// directory of name + external id.
export async function GET() {
  try {
    return publicJson(await listPublicSchools());
  } catch (error) {
    console.error('Error listing public schools:', error);
    return publicJson({ error: 'Internal server error' }, 500);
  }
}
