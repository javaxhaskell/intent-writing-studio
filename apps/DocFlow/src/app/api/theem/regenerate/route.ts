import { callClaudeTextStream } from '@/lib/studio/gateway';
import { RegenerateRequestSchema } from '@/lib/theem/contracts';

import { jsonError, requireUser, handleTheemError, briefBlock } from '../_lib';

export const maxDuration = 300;

/**
 * Streams a regenerated section as plain text (live-rendered on the draft
 * page for a fast, typewriter-style feel). Only the requested section is
 * rewritten; the surrounding sections are held fixed for coherence.
 */
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
      .map((s) => `${s.toUpperCase()} (fixed — do not repeat):\n${currentDraft[s]}`)
      .join('\n\n');

    const system = [
      'You are theem. Rewrite ONLY the requested section of an existing draft so it fits seamlessly between the fixed surrounding sections (consistent voice, facts and flow).',
      'Output ONLY the rewritten section as 2-3 short paragraphs of plain prose separated by blank lines. No preamble, no headers, no markdown, no quotation marks around the whole thing — just the prose.',
    ].join('\n');

    const user = [
      'BRIEF',
      briefBlock(brief),
      '',
      `Draft title: ${currentDraft.title}`,
      '',
      'SURROUNDING SECTIONS (fixed):',
      others,
      '',
      `REWRITE THE ${section.toUpperCase()} SECTION.`,
      `Chosen approach: "${selectionName}".`,
      `Section intent: ${sectionIntent}`,
      '',
      'Write the new section now.',
    ].join('\n');

    const stream = await callClaudeTextStream({ system, user, maxTokens: 1024 });

    return new Response(stream, {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'x-accel-buffering': 'no',
      },
    });
  } catch (err) {
    return handleTheemError(err);
  }
}
