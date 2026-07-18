import { randomUUID } from 'crypto';
import { z } from 'zod';

import {
  getAuthContext,
  getDocumentForUser,
  handleRouteError,
  jsonError,
  sha256Hex,
  toBlockRow,
  toIntentRow,
} from '../_lib/helpers';

import {
  DraftModelOutputSchema,
  GenerateDraftRequestSchema,
  PathwayPayloadSchema,
} from '@/lib/studio/contracts';
import { callClaudeJson } from '@/lib/studio/gateway';

export const maxDuration = 300;

type DraftIntent = z.infer<typeof DraftModelOutputSchema>['intents'][number];

const SYSTEM_PROMPT = [
  'You are a senior writer. You turn a chosen strategic pathway into an intent',
  'tree (the "why" behind every part of the piece) plus a first full draft,',
  'where every draft block is causally linked to exactly one paragraph-level',
  'intent. You respond with pure JSON only: no prose, no markdown fences.',
].join(' ');

function buildUserPrompt(pathwayJson: string, briefJson: string): string {
  return `Here is the selected pathway for the piece:
${pathwayJson}

Original brief:
${briefJson}

Produce an intent tree and a draft.

INTENT TREE RULES:
- Exactly ONE intent of kind "thesis" with "parentRef": null. It is the root; every other intent's ancestry leads to it.
- Exactly one "audience" intent and one "tone" intent, each with parentRef = the thesis ref.
- 3 to 5 "section_goal" intents with parentRef = the thesis ref, in reading order.
- Under each section_goal: 1 to 3 "paragraph_goal" intents (its children), in reading order.
- Exactly one "ending" intent with parentRef = the thesis ref, placed last.
- Every intent has: "ref" (short unique id like "sec-1" or "par-1-2"), "parentRef", "kind", "title" (short label), "purpose" (what this part must accomplish and why, 1-2 sentences).

BLOCK RULES:
- Exactly one block per "paragraph_goal" intent and one block for the "ending" intent. No blocks for thesis, audience, tone, or section_goal intents.
- Each block: { "intentRef": "<the leaf intent ref>", "contentMd": "markdown prose" }.
- Each contentMd is 60-150 words. Total across all blocks: 500-900 words.
- Blocks must read as one continuous piece in tree order and execute the pathway's tone and structure.

Return ONLY a JSON object of this exact shape (no markdown fences, no commentary):
{
  "intents": [ { "ref": "...", "parentRef": null, "kind": "thesis", "title": "...", "purpose": "..." } ],
  "blocks": [ { "intentRef": "...", "contentMd": "..." } ]
}`;
}

/** Orders intents so every parent precedes its children; null on cycle. */
function topologicalOrder(intents: DraftIntent[]): DraftIntent[] | null {
  const byRef = new Map(intents.map((intent) => [intent.ref, intent]));
  const placed = new Set<string>();
  const ordered: DraftIntent[] = [];
  let remaining = [...intents];

  while (remaining.length > 0) {
    const ready = remaining.filter(
      (intent) => !intent.parentRef || !byRef.has(intent.parentRef) || placed.has(intent.parentRef),
    );

    if (ready.length === 0) {
      return null; // cycle
    }

    for (const intent of ready) {
      placed.add(intent.ref);
      ordered.push(intent);
    }

    remaining = remaining.filter((intent) => !placed.has(intent.ref));
  }

  return ordered;
}

export async function POST(req: Request) {
  try {
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return jsonError(400, 'Request body must be JSON');
    }

    const parsed = GenerateDraftRequestSchema.safeParse(body);

    if (!parsed.success) {
      return jsonError(400, 'Invalid request', parsed.error.issues);
    }

    const { documentId, pathwayId } = parsed.data;
    const { supabase, userId } = await getAuthContext();

    if (!userId) {
      return jsonError(401, 'Not authenticated');
    }

    const document = await getDocumentForUser(supabase, documentId);

    if (!document) {
      return jsonError(404, 'Document not found');
    }

    // Load the selected pathway and verify it belongs to this document.
    const { data: pathway, error: pathwayError } = await supabase
      .from('pathways')
      .select('id, payload, pathway_set_id, pathway_sets!inner(document_id, brief)')
      .eq('id', pathwayId)
      .maybeSingle();

    if (pathwayError || !pathway || pathway.pathway_sets.document_id !== documentId) {
      return jsonError(404, 'Pathway not found for this document');
    }

    const payloadParsed = PathwayPayloadSchema.safeParse(pathway.payload);

    if (!payloadParsed.success) {
      return jsonError(500, 'Stored pathway payload is invalid');
    }

    // Mark this pathway selected, all siblings unselected.
    await supabase
      .from('pathways')
      .update({ selected: false })
      .eq('pathway_set_id', pathway.pathway_set_id);
    await supabase.from('pathways').update({ selected: true }).eq('id', pathwayId);

    const modelOutput = await callClaudeJson(DraftModelOutputSchema, {
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(
        JSON.stringify(payloadParsed.data, null, 2),
        JSON.stringify(pathway.pathway_sets.brief, null, 2),
      ),
      maxTokens: 8192,
    });

    const ordered = topologicalOrder(modelOutput.intents);

    if (!ordered) {
      return jsonError(502, 'Model returned a cyclic intent tree');
    }

    // Replace any prior draft for this document (demo slice: one draft at a time).
    const { error: blocksDeleteError } = await supabase
      .from('doc_blocks')
      .delete()
      .eq('document_id', documentId);
    const { error: intentsDeleteError } = await supabase
      .from('intent_nodes')
      .delete()
      .eq('document_id', documentId);

    if (blocksDeleteError || intentsDeleteError) {
      console.error(
        '[studio] prior draft cleanup failed:',
        blocksDeleteError?.message ?? intentsDeleteError?.message,
      );

      return jsonError(500, 'Failed to clear the previous draft');
    }

    // Map model-local refs to real UUIDs and compute sibling positions.
    const idByRef = new Map<string, string>();

    for (const intent of ordered) {
      idByRef.set(intent.ref, randomUUID());
    }

    const siblingCount = new Map<string, number>();
    const intentInserts = ordered.map((intent) => {
      const siblingKey = intent.parentRef ?? '__root__';
      const position = siblingCount.get(siblingKey) ?? 0;

      siblingCount.set(siblingKey, position + 1);

      return {
        id: idByRef.get(intent.ref)!,
        organization_id: document.organization_id,
        document_id: documentId,
        pathway_id: pathwayId,
        parent_id: intent.parentRef ? (idByRef.get(intent.parentRef) ?? null) : null,
        kind: intent.kind,
        title: intent.title,
        purpose: intent.purpose,
        position,
        status: 'current',
      };
    });

    const { data: intentRows, error: intentsInsertError } = await supabase
      .from('intent_nodes')
      .insert(intentInserts)
      .select();

    if (intentsInsertError || !intentRows) {
      console.error('[studio] intent_nodes insert failed:', intentsInsertError?.message);

      return jsonError(500, 'Failed to save the intent tree');
    }

    const blockInserts = modelOutput.blocks.map((block, index) => ({
      organization_id: document.organization_id,
      document_id: documentId,
      intent_node_id: idByRef.get(block.intentRef)!,
      position: index,
      content_md: block.contentMd,
      content_hash: sha256Hex(block.contentMd),
      freshness: 'current',
      locked: false,
    }));

    const { data: blockRows, error: blocksInsertError } = await supabase
      .from('doc_blocks')
      .insert(blockInserts)
      .select()
      .order('position', { ascending: true });

    if (blocksInsertError || !blockRows) {
      console.error('[studio] doc_blocks insert failed:', blocksInsertError?.message);

      return jsonError(500, 'Failed to save the draft blocks');
    }

    return Response.json({
      intents: intentRows.map(toIntentRow),
      blocks: blockRows.map(toBlockRow),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
