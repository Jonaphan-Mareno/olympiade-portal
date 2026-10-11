import { publicJson, publicRateLimitResponse } from '@/app/api/public/_shared';
import { listPublicPortals } from '@/domain/public-api/queries';

// Public (no auth): every portal with its status and the schools registered
// for it, so the consuming web app can filter by status client-side.
export async function GET() {
  const limited = await publicRateLimitResponse();
  if (limited) return limited;

  try {
    return publicJson(await listPublicPortals());
  } catch (error) {
    console.error('Error listing public portals:', error);
    return publicJson({ error: 'Internal server error' }, 500);
  }
}
