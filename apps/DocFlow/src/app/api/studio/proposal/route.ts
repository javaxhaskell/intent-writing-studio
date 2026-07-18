import {
  getAuthContext,
  handleRouteError,
  jsonError,
  sha256Hex,
  toBlockRow,
} from '../_lib/helpers';

import { ProposalDecisionRequestSchema } from '@/lib/studio/contracts';

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return jsonError(400, 'Request body must be JSON');
    }

    const parsed = ProposalDecisionRequestSchema.safeParse(body);

    if (!parsed.success) {
      return jsonError(400, 'Invalid request', parsed.error.issues);
    }

    const { blockId, decision } = parsed.data;
    const { supabase, userId } = await getAuthContext();

    if (!userId) {
      return jsonError(401, 'Not authenticated');
    }

    // RLS-scoped lookup: only returns the row when the user is an org member.
    const { data: block, error: blockError } = await supabase
      .from('doc_blocks')
      .select()
      .eq('id', blockId)
      .maybeSingle();

    if (blockError || !block) {
      return jsonError(404, 'Block not found');
    }

    if (decision === 'accept' && !block.proposed_md) {
      return jsonError(400, 'Block has no pending proposal to accept');
    }

    const update =
      decision === 'accept'
        ? {
            content_md: block.proposed_md!,
            content_hash: sha256Hex(block.proposed_md!),
            proposed_md: null,
            freshness: 'current',
          }
        : {
            proposed_md: null,
            freshness: 'current',
          };

    const { data: updated, error: updateError } = await supabase
      .from('doc_blocks')
      .update(update)
      .eq('id', blockId)
      .select()
      .single();

    if (updateError || !updated) {
      console.error('[studio] proposal decision failed:', updateError?.message);

      return jsonError(500, 'Failed to apply the proposal decision');
    }

    return Response.json(toBlockRow(updated));
  } catch (err) {
    return handleRouteError(err);
  }
}
