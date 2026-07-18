import { RegenerateRequestSchema, RegenModelOutputSchema } from '@/lib/studio/contracts';
import { callClaudeJson } from '@/lib/studio/gateway';

import {
  getAuthContext,
  getDocumentForUser,
  handleRouteError,
  jsonError,
  toBlockRow,
  toIntentRow,
  type SupabaseServerClient,
} from '../_lib/helpers';

export const maxDuration = 60;

const SYSTEM_PROMPT = [
  'You are a precise editor. Some paragraphs of a draft are stale because the',
  'author changed the intent behind them. You rewrite ONLY the stale paragraphs',
  'to satisfy their updated intents, keeping seamless flow with the surrounding',
  'unchanged text. You respond with pure JSON only: no prose, no markdown fences.',
].join(' ');

interface OutlineIntent {
  id: string;
  parent_id: string | null;
  kind: string;
  title: string;
  purpose: string;
  status: string;
  position: number;
}

function renderOutline(intents: OutlineIntent[]): string {
  const childrenByParent = new Map<string | null, OutlineIntent[]>();

  for (const intent of intents) {
    const siblings = childrenByParent.get(intent.parent_id) ?? [];

    siblings.push(intent);
    childrenByParent.set(intent.parent_id, siblings);
  }

  const lines: string[] = [];
  const walk = (parentId: string | null, depth: number) => {
    const nodes = (childrenByParent.get(parentId) ?? []).sort((a, b) => a.position - b.position);

    for (const node of nodes) {
      const marker = node.status === 'stale' ? ' [INTENT UPDATED]' : '';

      lines.push(`${'  '.repeat(depth)}- (${node.kind}) ${node.title}: ${node.purpose}${marker}`);
      walk(node.id, depth + 1);
    }
  };

  walk(null, 0);

  return lines.join('\n');
}

async function resetToStale(supabase: SupabaseServerClient, blockIds: string[]) {
  if (blockIds.length === 0) return;

  await supabase.from('doc_blocks').update({ freshness: 'stale' }).in('id', blockIds);
}

export async function POST(req: Request) {
  try {
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return jsonError(400, 'Request body must be JSON');
    }

    const parsed = RegenerateRequestSchema.safeParse(body);

    if (!parsed.success) {
      return jsonError(400, 'Invalid request', parsed.error.issues);
    }

    const { documentId } = parsed.data;
    const { supabase, userId } = await getAuthContext();

    if (!userId) {
      return jsonError(401, 'Not authenticated');
    }

    const document = await getDocumentForUser(supabase, documentId);

    if (!document) {
      return jsonError(404, 'Document not found');
    }

    const [{ data: allBlocks, error: blocksError }, { data: allIntents, error: intentsError }] =
      await Promise.all([
        supabase
          .from('doc_blocks')
          .select()
          .eq('document_id', documentId)
          .order('position', { ascending: true }),
        supabase
          .from('intent_nodes')
          .select('id, parent_id, kind, title, purpose, status, position')
          .eq('document_id', documentId),
      ]);

    if (blocksError || !allBlocks || intentsError || !allIntents) {
      console.error(
        '[studio] regenerate load failed:',
        blocksError?.message ?? intentsError?.message,
      );

      return jsonError(500, 'Failed to load the document state');
    }

    const staleBlocks = allBlocks.filter((block) => block.freshness === 'stale' && !block.locked);

    if (staleBlocks.length === 0) {
      return Response.json({ intents: [], blocks: [] });
    }

    const staleBlockIds = new Set(staleBlocks.map((block) => block.id));
    const intentById = new Map(allIntents.map((intent) => [intent.id, intent]));

    const documentRendering = allBlocks
      .map((block) => {
        const intent = intentById.get(block.intent_node_id);
        const intentLine = intent
          ? `Intent "${intent.title}": ${intent.purpose}`
          : 'Intent: unknown';

        if (staleBlockIds.has(block.id)) {
          return `[REWRITE blockId=${block.id}]\n${intentLine}\nCurrent text (stale):\n${block.content_md}`;
        }

        return `[KEEP — do not change]\n${block.content_md}`;
      })
      .join('\n\n---\n\n');

    const userPrompt = `The document's intent outline (nodes marked [INTENT UPDATED] were just changed by the author):

${renderOutline(allIntents)}

The document, block by block, in reading order. Blocks marked [KEEP] must not be touched. Blocks marked [REWRITE blockId=...] must be rewritten to satisfy their updated intent while flowing naturally with the surrounding kept text:

${documentRendering}

Rewrite ONLY the blocks marked [REWRITE]. Keep each rewritten block roughly the same length as the original (60-150 words). Match the established tone.

Return ONLY a JSON object of this exact shape (no markdown fences, no commentary), with one entry per rewritten block, using the exact blockId values given above:
{
  "blocks": [ { "blockId": "<uuid>", "contentMd": "markdown prose" } ]
}`;

    // Mark in-flight so state stays honest; reset to stale on any failure.
    await supabase
      .from('doc_blocks')
      .update({ freshness: 'regenerating' })
      .in('id', [...staleBlockIds]);

    let modelOutput;

    try {
      modelOutput = await callClaudeJson(RegenModelOutputSchema, {
        system: SYSTEM_PROMPT,
        user: userPrompt,
        maxTokens: 8192,
      });
    } catch (err) {
      await resetToStale(supabase, [...staleBlockIds]);
      throw err;
    }

    // Only apply proposals for blocks that were actually in the stale set.
    const proposals = modelOutput.blocks.filter((block) => staleBlockIds.has(block.blockId));

    if (proposals.length === 0) {
      await resetToStale(supabase, [...staleBlockIds]);

      return jsonError(502, 'Model did not return rewrites for the stale blocks');
    }

    for (const proposal of proposals) {
      const { error: proposalError } = await supabase
        .from('doc_blocks')
        .update({ proposed_md: proposal.contentMd, freshness: 'proposed' })
        .eq('id', proposal.blockId);

      if (proposalError) {
        console.error('[studio] proposal write failed:', proposalError.message);
      }
    }

    // Any stale block the model skipped goes back to stale (not stuck regenerating).
    const proposedIds = new Set(proposals.map((proposal) => proposal.blockId));

    await resetToStale(
      supabase,
      [...staleBlockIds].filter((id) => !proposedIds.has(id)),
    );

    // The updated intents are now satisfied by the proposals.
    const staleIntentIds = allIntents
      .filter((intent) => intent.status === 'stale')
      .map((intent) => intent.id);

    if (staleIntentIds.length > 0) {
      const { error: intentsCurrentError } = await supabase
        .from('intent_nodes')
        .update({ status: 'current' })
        .in('id', staleIntentIds);

      if (intentsCurrentError) {
        console.error('[studio] intent status reset failed:', intentsCurrentError.message);
      }
    }

    const [{ data: updatedBlocks }, { data: updatedIntents }] = await Promise.all([
      supabase
        .from('doc_blocks')
        .select()
        .eq('document_id', documentId)
        .order('position', { ascending: true }),
      supabase
        .from('intent_nodes')
        .select()
        .eq('document_id', documentId)
        .order('position', { ascending: true }),
    ]);

    return Response.json({
      intents: (updatedIntents ?? []).map(toIntentRow),
      blocks: (updatedBlocks ?? []).map(toBlockRow),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
