import { z } from 'zod';

/**
 * Contracts for the theem sectional wizard (Brief → Beginning → Middle →
 * Ending → Draft). Stateless: the browser holds the wizard state and each
 * step is a schema-validated model call. Distinct from the studio slice's
 * persisted intent-graph model in @/lib/studio/contracts.
 */

export const StageSchema = z.enum(['beginning', 'middle', 'ending']);
export type Stage = z.infer<typeof StageSchema>;

export const BriefSchema = z.object({
  coreMessage: z.string().min(1).max(2000),
  audience: z.string().min(1).max(1000),
  desiredEffect: z.string().min(1).max(1000),
  mustInclude: z.string().max(2000).default(''),
  mustAvoid: z.string().max(2000).default(''),
});
export type TheemBrief = z.infer<typeof BriefSchema>;

/** One selectable option for a section (matches the frontend card shape). */
export const OptionSchema = z.object({
  name: z.string().min(1).max(80),
  tone: z.string().min(1).max(60),
  summary: z.string().min(1).max(400),
  sample: z.string().min(1).max(600),
  steps: z.array(z.string().min(1).max(120)).length(3),
  match: z.string().min(1).max(24),
});
export type TheemOption = z.infer<typeof OptionSchema>;

export const OptionsModelOutputSchema = z.object({
  options: z.array(OptionSchema).length(4),
});

const SelectionSchema = OptionSchema.pick({ name: true, tone: true, summary: true });

export const PathwaysRequestSchema = z.object({
  brief: BriefSchema,
  stage: StageSchema,
  intent: z.string().min(1).max(1200),
  priorSelections: z
    .object({
      beginning: SelectionSchema.nullable().optional(),
      middle: SelectionSchema.nullable().optional(),
    })
    .default({}),
});

export const DraftRequestSchema = z.object({
  brief: BriefSchema,
  intents: z.object({
    beginning: z.string().min(1).max(1200),
    middle: z.string().min(1).max(1200),
    ending: z.string().min(1).max(1200),
  }),
  selections: z.object({
    beginning: OptionSchema,
    middle: OptionSchema,
    ending: OptionSchema,
  }),
});

export const DraftModelOutputSchema = z.object({
  title: z.string().min(1).max(140),
  dek: z.string().min(1).max(400),
  beginning: z.string().min(1).max(3000),
  middle: z.string().min(1).max(3000),
  ending: z.string().min(1).max(3000),
});
export type TheemDraft = z.infer<typeof DraftModelOutputSchema>;

export const RegenerateRequestSchema = z.object({
  brief: BriefSchema,
  section: StageSchema,
  sectionIntent: z.string().min(1).max(1200),
  selectionName: z.string().min(1).max(80),
  currentDraft: z.object({
    title: z.string().max(140),
    beginning: z.string().max(3000),
    middle: z.string().max(3000),
    ending: z.string().max(3000),
  }),
});

export const SectionModelOutputSchema = z.object({
  content: z.string().min(1).max(3000),
});
