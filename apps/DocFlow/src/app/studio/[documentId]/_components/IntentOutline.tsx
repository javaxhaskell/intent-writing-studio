'use client';

import { KIND_LABELS } from './intent-utils';

import type { IntentNodeRow } from '@/lib/studio/contracts';
import { cn } from '@/utils';

function OutlineNode({
  intent,
  childrenByParent,
  depth,
  highlightedIntentId,
  onHighlight,
}: {
  intent: IntentNodeRow;
  childrenByParent: Map<string | null, IntentNodeRow[]>;
  depth: number;
  highlightedIntentId: string | null;
  onHighlight: (intentId: string | null) => void;
}) {
  const children = childrenByParent.get(intent.id) ?? [];
  const highlighted = highlightedIntentId === intent.id;

  return (
    <li>
      <button
        type="button"
        onClick={() => onHighlight(highlighted ? null : intent.id)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-accent',
          highlighted && 'bg-accent',
        )}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        title={intent.purpose}
      >
        <span
          className={cn(
            'size-2 shrink-0 rounded-full',
            intent.status === 'stale' ? 'bg-amber-500' : 'bg-emerald-500',
          )}
          aria-label={intent.status === 'stale' ? 'Stale' : 'Current'}
        />
        <span className="min-w-0 flex-1 truncate">{intent.title}</span>
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
          {KIND_LABELS[intent.kind]}
        </span>
      </button>
      {children.length > 0 ? (
        <ul>
          {children.map((child) => (
            <OutlineNode
              key={child.id}
              intent={child}
              childrenByParent={childrenByParent}
              depth={depth + 1}
              highlightedIntentId={highlightedIntentId}
              onHighlight={onHighlight}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function IntentOutline({
  intents,
  highlightedIntentId,
  onHighlight,
}: {
  intents: IntentNodeRow[];
  highlightedIntentId: string | null;
  onHighlight: (intentId: string | null) => void;
}) {
  const knownIds = new Set(intents.map((intent) => intent.id));
  const childrenByParent = new Map<string | null, IntentNodeRow[]>();

  for (const intent of intents) {
    // Treat orphaned parents as roots so nothing silently disappears.
    const parentKey = intent.parent_id && knownIds.has(intent.parent_id) ? intent.parent_id : null;
    const list = childrenByParent.get(parentKey) ?? [];
    list.push(intent);
    childrenByParent.set(parentKey, list);
  }

  const roots = childrenByParent.get(null) ?? [];

  return (
    <div>
      <h3 className="text-sm font-semibold">Intent outline</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        The reasoning skeleton behind the draft. Click an intent to highlight the blocks it
        produces; click a block on the left to inspect its intent.
      </p>
      <ul className="mt-3 space-y-0.5">
        {roots.map((intent) => (
          <OutlineNode
            key={intent.id}
            intent={intent}
            childrenByParent={childrenByParent}
            depth={0}
            highlightedIntentId={highlightedIntentId}
            onHighlight={onHighlight}
          />
        ))}
      </ul>
    </div>
  );
}
