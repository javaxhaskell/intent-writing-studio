import { callClaudeJson } from '@/lib/studio/gateway';
import { DraftRequestSchema, DraftModelOutputSchema } from '@/lib/theem/contracts';

import { jsonError, requireUser, handleTheemError, briefBlock } from '../_lib';

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return jsonError(400, 'Request body must be JSON');
    }

    const parsed = DraftRequestSchema.safeParse(body);

    if (!parsed.success) {
      return jsonError(400, 'Invalid request', parsed.error.issues);
    }

    if (!(await requireUser())) {
      return jsonError(401, 'Not signed in');
    }

    const { brief, intents, selections } = parsed.data;

    const system = [
      "You are theem. Assemble a coherent draft from the writer's chosen beginning, middle and ending approaches. The three chosen approaches must flow as one continuous piece — consistent voice, no repetition across sections.",
      'Return ONLY JSON: {"title","dek","beginning","middle","ending"}.',
      '- title: a strong headline for the piece.',
      '- dek: one-sentence standfirst under the title.',
      '- beginning/middle/ending: the section prose. Each section is 2-3 short paragraphs separated by a blank line. Plain prose, no markdown headers.',
      'Honour the core message, audience, and the must-include / must-avoid constraints throughout. No markdown fences.',
    ].join('\n');

    const user = [
      'BRIEF',
      briefBlock(brief),
      '',
      'CHOSEN ARCHITECTURE',
      `Beginning — "${selections.beginning.name}" (${selections.beginning.tone}). Intent: ${intents.beginning}. Direction: ${selections.beginning.summary}`,
      `Middle — "${selections.middle.name}" (${selections.middle.tone}). Intent: ${intents.middle}. Direction: ${selections.middle.summary}`,
      `Ending — "${selections.ending.name}" (${selections.ending.tone}). Intent: ${intents.ending}. Direction: ${selections.ending.summary}`,
      '',
      'Write the assembled draft now as JSON.',
    ].join('\n');

    const result = await callClaudeJson(DraftModelOutputSchema, {
      system,
      user,
      maxTokens: 3000,
    });

    return Response.json(result);
  } catch (err) {
    return handleTheemError(err);
  }
}
