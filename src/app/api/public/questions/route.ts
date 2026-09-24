import { publicJson } from '@/app/api/public/_shared';
import { isSemiPublicAvailable } from '@/domain/public-api/access';
import {
  getPublicRoundContext,
  listRoundQuestions,
} from '@/domain/public-api/queries';

// Public (no auth) but semi-gated: a round's questions - correct answers
// included - become readable once the round has closed, at which point they
// are historical and can no longer give anyone a live advantage.
export async function GET(request: Request) {
  try {
    const roundId = new URL(request.url).searchParams.get('round_id')?.trim();
    if (!roundId) return publicJson({ error: 'Missing round_id' }, 400);

    const context = await getPublicRoundContext(roundId);
    if (!context) return publicJson({ error: 'Round not found' }, 404);

    if (!isSemiPublicAvailable(context.round)) {
      return publicJson({ error: 'This round has not closed yet' }, 403);
    }

    return publicJson({
      round: { id: context.round.id, name: context.round.name },
      portal: context.portal,
      questions: await listRoundQuestions(roundId),
    });
  } catch (error) {
    console.error('Error listing public questions:', error);
    return publicJson({ error: 'Internal server error' }, 500);
  }
}
