import { z } from 'zod';

import { UpdateIntentRequestSchema, type ImpactPreview } from '@/lib/studio/contracts';

import { getAuthContext, handleRouteError, jsonError } from '../_lib/helpers';

export const maxDuration = 60;

const BodySchema = z.object({
  ...UpdateIntentRequestSchema.shape,
  previewOnly: z.boolean().optional(),
});

export async function POST(req: Request) {
  try {
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return jsonError(400, 'Request body must be JSON');
    }

    const parsed = BodySchema.safeParse(body);

    if (!parsed.success) {
      return jsonError(400, 'Invalid request', parsed.error.issues);
    }

    const { intentId, title, purpose, previewOnly } = parsed.data;
    const { supabase, userId } = await getAuthContext();

    if (!userId) {
      return jsonError(401, 'Not authenticated');
    }

    // RLS-scoped lookup: only returns the row when the user is an org member.
    const { data: editedIntent, error: intentError } = await supabase
      .from('intent_nodes')
      .select('id, document_id, organization_id, title')
      .eq('id', intentId)
      .maybeSingle();

    if (intentError || !editedIntent) {
      return jsonError(404, 'Intent not found');
    }

    // Load the whole intent tree for the document and walk descendants.
    const { data: allIntents, error: treeError } = await supabase
      .from('intent_nodes')
      .select('id, parent_id, title, position')
      .eq('document_id', editedIntent.document_id)
      .order('position', { ascending: true });

    if (treeError || !allIntents) {
      console.error('[studio] intent tree load failed:', treeError?.message);

      return jsonError(500, 'Failed to load the intent tree');
    }

    const childrenByParent = new Map<string, typeof allIntents>();

    for (const node of allIntents) {
      if (node.parent_id) {
        const siblings = childrenByParent.get(node.parent_id) ?? [];

        siblings.push(node);
        childrenByParent.set(node.parent_id, siblings);
      }
    }

    const titleById = new Map(allIntents.map((node) => [node.id, node.title]));
    const affectedIntents: ImpactPreview['affectedIntents'] = [
      { id: intentId, title, reason: 'directly edited' },
    ];
    const queue: string[] = [intentId];
    const seen = new Set<string>([intentId]);

    while (queue.length > 0) {
      const currentId = queue.shift()!;

      for (const child of childrenByParent.get(currentId) ?? []) {
        if (seen.has(child.id)) {
          continue;
        }

        seen.add(child.id);
        const parentTitle = currentId === intentId ? title : (titleById.get(currentId) ?? 'parent');

        affectedIntents.push({
          id: child.id,
          title: child.title,
          reason: `depends on the edited intent via ${parentTitle}`,
        });
        queue.push(child.id);
      }
    }

    const affectedIntentIds = affectedIntents.map((intent) => intent.id);

    const { data: linkedBlocks, error: blocksError } = await supabase
      .from('doc_blocks')
      .select('id, content_md, locked, position')
      .in('intent_node_id', affectedIntentIds)
      .eq('document_id', editedIntent.document_id)
      .order('position', { ascending: true });

    if (blocksError || !linkedBlocks) {
      console.error('[studio] affected blocks load failed:', blocksError?.message);

      return jsonError(500, 'Failed to load affected blocks');
    }

    const preview: ImpactPreview = {
      intentId,
      affectedIntents,
      affectedBlocks: linkedBlocks.map((block) => ({
        id: block.id,
        excerpt: block.content_md.slice(0, 140),
        locked: block.locked,
      })),
    };

    if (previewOnly) {
      return Response.json(preview);
    }

    // Apply: update the intent, then propagate staleness.
    const { error: updateError } = await supabase
      .from('intent_nodes')
      .update({ title, purpose })
      .eq('id', intentId);

    if (updateError) {
      console.error('[studio] intent update failed:', updateError.message);

      return jsonError(500, 'Failed to update the intent');
    }

    const { error: staleIntentsError } = await supabase
      .from('intent_nodes')
      .update({ status: 'stale' })
      .in('id', affectedIntentIds);

    if (staleIntentsError) {
      console.error('[studio] intent staleness update failed:', staleIntentsError.message);

      return jsonError(500, 'Failed to mark affected intents stale');
    }

    const { error: staleBlocksError } = await supabase
      .from('doc_blocks')
      .update({ freshness: 'stale' })
      .in('intent_node_id', affectedIntentIds)
      .eq('locked', false);

    if (staleBlocksError) {
      console.error('[studio] block staleness update failed:', staleBlocksError.message);

      return jsonError(500, 'Failed to mark affected blocks stale');
    }

    return Response.json(preview);
  } catch (err) {
    return handleRouteError(err);
  }
}
