import { z } from 'zod';

import { getAuthContext, handleRouteError, jsonError, toBlockRow } from '../_lib/helpers';

export const maxDuration = 60;

const BlockLockRequestSchema = z.object({
  blockId: z.string().uuid(),
  locked: z.boolean(),
});

export async function POST(req: Request) {
  try {
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return jsonError(400, 'Request body must be JSON');
    }

    const parsed = BlockLockRequestSchema.safeParse(body);

    if (!parsed.success) {
      return jsonError(400, 'Invalid request', parsed.error.issues);
    }

    const { blockId, locked } = parsed.data;
    const { supabase, userId } = await getAuthContext();

    if (!userId) {
      return jsonError(401, 'Not authenticated');
    }

    // RLS-scoped lookup: only returns the row when the user is an org member.
    const { data: block, error: blockError } = await supabase
      .from('doc_blocks')
      .select('id')
      .eq('id', blockId)
      .maybeSingle();

    if (blockError || !block) {
      return jsonError(404, 'Block not found');
    }

    const { data: updated, error: updateError } = await supabase
      .from('doc_blocks')
      .update({ locked })
      .eq('id', blockId)
      .select()
      .single();

    if (updateError || !updated) {
      console.error('[studio] block lock update failed:', updateError?.message);

      return jsonError(500, 'Failed to update the block lock');
    }

    return Response.json(toBlockRow(updated));
  } catch (err) {
    return handleRouteError(err);
  }
}
