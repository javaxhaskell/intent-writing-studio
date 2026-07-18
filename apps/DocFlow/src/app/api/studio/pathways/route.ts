import { getAuthContext, getDocumentForUser, handleRouteError, jsonError } from '../_lib/helpers';

import type { Json } from '@/types/database';
import {
  GeneratePathwaysRequestSchema,
  PathwaySetModelOutputSchema,
  type Brief,
} from '@/lib/studio/contracts';
import { callClaudeJson, getModelId } from '@/lib/studio/gateway';

export const maxDuration = 300;

const SYSTEM_PROMPT = [
  'You are a senior writing strategist. Given a writing brief, you propose',
  'genuinely distinct strategic pathways for the piece — not variations on one',
  'idea, but different bets about narrative strategy, structure, and tone.',
  'You respond with pure JSON only: no prose, no markdown fences.',
].join(' ');

function buildUserPrompt(brief: Brief): string {
  return `Here is the writing brief:

GOAL: ${brief.goal}
AUDIENCE: ${brief.audience}
CONSTRAINTS: ${brief.constraints || '(none given)'}
SOURCE NOTES: ${brief.sourceNotes || '(none given)'}

Propose exactly 4 MEANINGFULLY different pathways for this piece. Differentiate them along strategy axes such as: narrative vs analytical, problem-first vs vision-first, cautious vs provocative, evidence-led vs story-led. Two pathways must never be minor rewordings of each other — each must make a different strategic bet, and each pathway's "differenceFromOthers" must state concretely how it differs from the other three.

Return ONLY a JSON object of this exact shape (no markdown fences, no commentary):
{
  "pathways": [
    {
      "title": "string, <= 120 chars",
      "oneSentenceApproach": "string, <= 300 chars",
      "thesis": "string, <= 500 chars",
      "audienceStrategy": "string, <= 400 chars",
      "tone": "string, <= 200 chars",
      "structure": ["3-8 strings, each a section of the piece in order"],
      "keyDecisions": ["1-6 strings"],
      "assumptions": ["1-6 strings"],
      "tradeoffs": ["1-6 strings"],
      "evidenceNeeded": ["0-6 strings"],
      "endingStrategy": "string, <= 400 chars",
      "differenceFromOthers": "string, <= 400 chars"
    }
  ]
}`;
}

export async function POST(req: Request) {
  try {
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return jsonError(400, 'Request body must be JSON');
    }

    const parsed = GeneratePathwaysRequestSchema.safeParse(body);

    if (!parsed.success) {
      return jsonError(400, 'Invalid request', parsed.error.issues);
    }

    const { supabase, userId } = await getAuthContext();

    if (!userId) {
      return jsonError(401, 'Not authenticated');
    }

    const document = await getDocumentForUser(supabase, parsed.data.documentId);

    if (!document) {
      return jsonError(404, 'Document not found');
    }

    const modelOutput = await callClaudeJson(PathwaySetModelOutputSchema, {
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(parsed.data.brief),
      maxTokens: 8192,
    });

    const { data: set, error: setError } = await supabase
      .from('pathway_sets')
      .insert({
        organization_id: document.organization_id,
        document_id: document.id,
        brief: parsed.data.brief as unknown as Json,
        status: 'ready',
        model_id: getModelId(),
      })
      .select('id')
      .single();

    if (setError || !set) {
      console.error('[studio] pathway_sets insert failed:', setError?.message);

      return jsonError(500, 'Failed to save pathway set');
    }

    const { data: pathwayRows, error: pathwaysError } = await supabase
      .from('pathways')
      .insert(
        modelOutput.pathways.map((payload, index) => ({
          organization_id: document.organization_id,
          pathway_set_id: set.id,
          payload: payload as unknown as Json,
          rank: index,
          selected: false,
        })),
      )
      .select('id, payload, rank')
      .order('rank', { ascending: true });

    if (pathwaysError || !pathwayRows) {
      console.error('[studio] pathways insert failed:', pathwaysError?.message);

      return jsonError(500, 'Failed to save pathways');
    }

    return Response.json({
      setId: set.id,
      pathways: pathwayRows.map((row) => ({
        id: row.id,
        payload: row.payload,
        rank: row.rank,
      })),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
