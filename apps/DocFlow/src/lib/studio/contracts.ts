import { z } from 'zod';

/**
 * Shared contracts for the demo studio slice: brief -> pathways -> selection ->
 * intent-linked draft -> intent edit -> impact preview -> targeted regeneration.
 *
 * These schemas validate ALL model output before persistence or rendering
 * (docs/decisions/0003). Route handlers and UI both import from here.
 */

// ---------------------------------------------------------------------------
// Brief
// ---------------------------------------------------------------------------
export const BriefSchema = z.object({
  goal: z.string().min(1).max(2000),
  audience: z.string().min(1).max(1000),
  constraints: z.string().max(2000).default(''),
  sourceNotes: z.string().max(6000).default(''),
});
export type Brief = z.infer<typeof BriefSchema>;

// ---------------------------------------------------------------------------
// Pathways (model output — strict validation)
// ---------------------------------------------------------------------------
export const PathwayPayloadSchema = z.object({
  title: z.string().min(1).max(120),
  oneSentenceApproach: z.string().min(1).max(300),
  thesis: z.string().min(1).max(500),
  audienceStrategy: z.string().min(1).max(400),
  tone: z.string().min(1).max(200),
  structure: z.array(z.string().min(1).max(200)).min(3).max(8),
  keyDecisions: z.array(z.string().min(1).max(300)).min(1).max(6),
  assumptions: z.array(z.string().min(1).max(300)).min(1).max(6),
  tradeoffs: z.array(z.string().min(1).max(300)).min(1).max(6),
  evidenceNeeded: z.array(z.string().min(1).max(300)).max(6).default([]),
  endingStrategy: z.string().min(1).max(400),
  differenceFromOthers: z.string().min(1).max(400),
});
export type PathwayPayload = z.infer<typeof PathwayPayloadSchema>;

export const PathwaySetModelOutputSchema = z.object({
  pathways: z.array(PathwayPayloadSchema).min(3).max(5),
});

// ---------------------------------------------------------------------------
// Draft generation (model output): intent tree + blocks linked by clientRef
// ---------------------------------------------------------------------------
export const IntentKindSchema = z.enum([
  'thesis',
  'audience',
  'tone',
  'section_goal',
  'paragraph_goal',
  'ending',
]);
export type IntentKind = z.infer<typeof IntentKindSchema>;

export const DraftIntentSchema = z.object({
  ref: z.string().min(1).max(40), // model-local id, e.g. "sec-1"
  parentRef: z.string().min(1).max(40).nullable(),
  kind: IntentKindSchema,
  title: z.string().min(1).max(200),
  purpose: z.string().min(1).max(600),
});

export const DraftBlockSchema = z.object({
  intentRef: z.string().min(1).max(40), // must match a DraftIntent.ref
  contentMd: z.string().min(1).max(4000),
});

export const DraftModelOutputSchema = z
  .object({
    intents: z.array(DraftIntentSchema).min(3).max(30),
    blocks: z.array(DraftBlockSchema).min(3).max(24),
  })
  .superRefine((val, ctx) => {
    const refs = new Set(val.intents.map((i) => i.ref));
    if (refs.size !== val.intents.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'duplicate intent refs' });
    }

    for (const i of val.intents) {
      if (i.parentRef && !refs.has(i.parentRef)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `intent ${i.ref} has unknown parentRef ${i.parentRef}`,
        });
      }
    }

    for (const b of val.blocks) {
      if (!refs.has(b.intentRef)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `block references unknown intent ${b.intentRef}`,
        });
      }
    }
  });

// ---------------------------------------------------------------------------
// Regeneration (model output)
// ---------------------------------------------------------------------------
export const RegenModelOutputSchema = z.object({
  blocks: z
    .array(
      z.object({
        blockId: z.string().uuid(),
        contentMd: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(24),
});

// ---------------------------------------------------------------------------
// API request/response shapes (route handlers <-> UI)
// ---------------------------------------------------------------------------
export const GeneratePathwaysRequestSchema = z.object({
  documentId: z.string().uuid(),
  brief: BriefSchema,
});

export const GenerateDraftRequestSchema = z.object({
  documentId: z.string().uuid(),
  pathwayId: z.string().uuid(),
});

export const UpdateIntentRequestSchema = z.object({
  intentId: z.string().uuid(),
  title: z.string().min(1).max(200),
  purpose: z.string().min(1).max(600),
});

export const RegenerateRequestSchema = z.object({
  documentId: z.string().uuid(),
});

export const ProposalDecisionRequestSchema = z.object({
  blockId: z.string().uuid(),
  decision: z.enum(['accept', 'reject']),
});

/** Rows as the UI consumes them (subset of DB rows, snake_case preserved). */
export interface IntentNodeRow {
  id: string;
  parent_id: string | null;
  kind: IntentKind;
  title: string;
  purpose: string;
  position: number;
  status: 'current' | 'stale';
  pathway_id: string | null;
}

export interface DocBlockRow {
  id: string;
  intent_node_id: string;
  position: number;
  content_md: string;
  proposed_md: string | null;
  freshness: 'current' | 'stale' | 'regenerating' | 'proposed';
  locked: boolean;
}

export interface ImpactPreview {
  intentId: string;
  affectedIntents: Array<{ id: string; title: string; reason: string }>;
  affectedBlocks: Array<{ id: string; excerpt: string; locked: boolean }>;
}
