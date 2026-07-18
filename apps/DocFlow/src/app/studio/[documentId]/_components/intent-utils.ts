import type { IntentKind, IntentNodeRow } from '@/lib/studio/contracts';

export const KIND_LABELS: Record<IntentKind, string> = {
  thesis: 'Thesis',
  audience: 'Audience',
  tone: 'Tone',
  section_goal: 'Section goal',
  paragraph_goal: 'Paragraph goal',
  ending: 'Ending',
};

export const KIND_BADGE_CLASSES: Record<IntentKind, string> = {
  thesis:
    'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300',
  audience:
    'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300',
  tone: 'border-pink-300 bg-pink-50 text-pink-700 dark:border-pink-800 dark:bg-pink-950/50 dark:text-pink-300',
  section_goal:
    'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
  paragraph_goal:
    'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300',
  ending:
    'border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950/50 dark:text-orange-300',
};

export function buildIntentMap(intents: IntentNodeRow[]): Map<string, IntentNodeRow> {
  return new Map(intents.map((intent) => [intent.id, intent]));
}

/** Ancestor chain from the root down to (excluding) the given intent. */
export function ancestorChain(
  intent: IntentNodeRow,
  intentMap: Map<string, IntentNodeRow>,
): IntentNodeRow[] {
  const chain: IntentNodeRow[] = [];
  const seen = new Set<string>([intent.id]);
  let current = intent.parent_id ? intentMap.get(intent.parent_id) : undefined;

  while (current && !seen.has(current.id)) {
    chain.unshift(current);
    seen.add(current.id);
    current = current.parent_id ? intentMap.get(current.parent_id) : undefined;
  }

  return chain;
}

/** Nearest ancestor (or self) that is a section goal — used to group blocks. */
export function sectionFor(
  intent: IntentNodeRow | undefined,
  intentMap: Map<string, IntentNodeRow>,
): IntentNodeRow | null {
  const seen = new Set<string>();
  let current = intent;

  while (current && !seen.has(current.id)) {
    if (current.kind === 'section_goal') return current;
    seen.add(current.id);
    current = current.parent_id ? intentMap.get(current.parent_id) : undefined;
  }

  return null;
}
