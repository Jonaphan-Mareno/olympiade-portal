import { publicJson } from '@/app/api/public/_shared';
import { areResultsPublished } from '@/domain/public-api/access';
import {
  getPublicRoundContext,
  listRoundScores,
} from '@/domain/public-api/queries';

// Public (no auth) but gated: marks are only exposed once the organiser has
// published the round's results. Scores are anonymous - marks only, no
// student identities - so they can power public leaderboards.
export async function GET(request: Request) {
  try {
    const roundId = new URL(request.url).searchParams.get('round_id')?.trim();
    if (!roundId) return publicJson({ error: 'Missing round_id' }, 400);

    const context = await getPublicRoundContext(roundId);
    if (!context) return publicJson({ error: 'Round not found' }, 404);

    if (!areResultsPublished(context.round)) {
      return publicJson(
        { error: 'Results for this round have not been published yet' },
        403
      );
    }

    const scores = await listRoundScores(roundId);

    return publicJson({
      round: { id: context.round.id, name: context.round.name },
      portal: context.portal,
      results: scores.map((score) => ({ score })),
    });
  } catch (error) {
    console.error('Error listing public results:', error);
    return publicJson({ error: 'Internal server error' }, 500);
  }
}
