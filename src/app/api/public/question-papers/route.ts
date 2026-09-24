import { publicJson } from '@/app/api/public/_shared';
import { isSemiPublicAvailable } from '@/domain/public-api/access';
import {
  getPublicRoundContext,
  listRoundQuestionPapers,
} from '@/domain/public-api/queries';

// Public (no auth) but semi-gated: a round's question papers become readable
// once the round has closed, so they cannot leak to entrants still writing.
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
      question_papers: await listRoundQuestionPapers(roundId),
    });
  } catch (error) {
    console.error('Error listing public question papers:', error);
    return publicJson({ error: 'Internal server error' }, 500);
  }
}
