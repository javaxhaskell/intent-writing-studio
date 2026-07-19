import { callClaudeJson } from '@/lib/studio/gateway';
import { PathwaysRequestSchema, OptionsModelOutputSchema } from '@/lib/theem/contracts';

import { jsonError, requireUser, handleTheemError, briefBlock } from '../_lib';

export const maxDuration = 300;

const STAGE_GUIDANCE: Record<string, string> = {
  beginning:
    'the OPENING of the piece — how the reader first enters the argument (the first 1-2 paragraphs).',
  middle:
    'the MIDDLE of the piece — how the case is developed, evidence introduced, and reasoning unfolds.',
  ending:
    'the ENDING of the piece — what remains with the reader after the final line (the last 1-2 paragraphs).',
};

export async function POST(req: Request) {
  try {
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return jsonError(400, 'Request body must be JSON');
    }

    const parsed = PathwaysRequestSchema.safeParse(body);

    if (!parsed.success) {
      return jsonError(400, 'Invalid request', parsed.error.issues);
    }

    if (!(await requireUser())) {
      return jsonError(401, 'Not signed in');
    }

    const { brief, stage, intent, priorSelections } = parsed.data;

    const priorLines = [
      priorSelections.beginning
        ? `Already chosen beginning: "${priorSelections.beginning.name}" — ${priorSelections.beginning.summary}`
        : '',
      priorSelections.middle
        ? `Already chosen middle: "${priorSelections.middle.name}" — ${priorSelections.middle.summary}`
        : '',
    ].filter(Boolean);

    const system = [
      'You are theem, a decision-first writing tool. The foundation model is frozen; you help a writer choose the SHAPE of a piece before any full draft is written.',
      `Generate exactly FOUR genuinely distinct options for ${STAGE_GUIDANCE[stage]}`,
      'The four options must differ in real strategy (e.g. narrative vs analytical, immersive vs clinical, provocative vs measured) — not just wording. Each must serve the same core message and the section intent.',
      'Return ONLY JSON of the shape: {"options":[{"name","tone","summary","sample","steps","match"}]} with exactly 4 options.',
      '- name: 2-4 word title for the approach.',
      '- tone: two descriptors joined by " · " (e.g. "Immersive · unsettling").',
      '- summary: one sentence describing the approach.',
      '- sample: 1-2 sentences of ACTUAL example prose the reader would see, written in this approach.',
      '- steps: exactly 3 short phrases describing how the section moves.',
      '- match: a plausible "NN% intent match" string, highest first (e.g. "91% intent match"), descending across the four.',
      'No markdown, no prose outside the JSON.',
    ].join('\n');

    const user = [
      'BRIEF',
      briefBlock(brief),
      '',
      priorLines.length ? priorLines.join('\n') : '',
      priorLines.length ? '' : '',
      `SECTION INTENT (${stage}): ${intent}`,
      '',
      `Produce the four ${stage} options now.`,
    ]
      .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
      .join('\n');

    const result = await callClaudeJson(OptionsModelOutputSchema, {
      system,
      user,
      maxTokens: 2600,
    });

    return Response.json(result);
  } catch (err) {
    return handleTheemError(err);
  }
}
