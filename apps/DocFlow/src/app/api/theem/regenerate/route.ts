import { callClaudeJson } from '@/lib/studio/gateway';
import { RegenerateRequestSchema, SectionModelOutputSchema } from '@/lib/theem/contracts';

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

    const parsed = RegenerateRequestSchema.safeParse(body);

    if (!parsed.success) {
      return jsonError(400, 'Invalid request', parsed.error.issues);
    }

    if (!(await requireUser())) {
      return jsonError(401, 'Not signed in');
    }

    const { brief, section, sectionIntent, selectionName, currentDraft } = parsed.data;

    const others = (['beginning', 'middle', 'ending'] as const)
      .filter((s) => s !== section)
      .map((s) => `${s.toUpperCase()} (unchanged):\n${currentDraft[s]}`)
      .join('\n\n');

    const system = [
      'You are theem. Regenerate ONLY the requested section of an existing draft. The surrounding sections are fixed — your new section must fit between them seamlessly (voice, facts, and flow consistent).',
      'Return ONLY JSON: {"content"} where content is the rewritten section as 2-3 short paragraphs separated by blank lines. Plain prose, no markdown headers or fences.',
    ].join('\n');

    const user = [
      'BRIEF',
      briefBlock(brief),
      '',
      `Draft title: ${currentDraft.title}`,
      '',
      'SURROUNDING SECTIONS THAT MUST NOT CHANGE:',
      others,
      '',
      `REGENERATE THE ${section.toUpperCase()} SECTION.`,
      `Chosen approach: "${selectionName}". Section intent: ${sectionIntent}`,
      '',
      'Return the new section as JSON now.',
    ].join('\n');

    const result = await callClaudeJson(SectionModelOutputSchema, {
      system,
      user,
      maxTokens: 1600,
    });

    return Response.json(result);
  } catch (err) {
    return handleTheemError(err);
  }
}
