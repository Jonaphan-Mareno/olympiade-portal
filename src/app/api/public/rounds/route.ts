import { publicJson } from '@/app/api/public/_shared';
import { listPublicRounds } from '@/domain/public-api/queries';

// Public (no auth): every round with its portal, threshold and schedule.
export async function GET() {
  try {
    return publicJson(await listPublicRounds());
  } catch (error) {
    console.error('Error listing public rounds:', error);
    return publicJson({ error: 'Internal server error' }, 500);
  }
}
