'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Check, Lock, X } from 'lucide-react';

import { IntentLens } from './IntentLens';
import { IntentOutline } from './IntentOutline';
import { buildIntentMap, sectionFor } from './intent-utils';
import type { PathwayRow } from './useStudio';

import type { DocBlockRow, ImpactPreview, IntentNodeRow } from '@/lib/studio/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/utils';

/** Renders `**bold**` spans; everything else stays plain text. */
function renderInline(text: string): ReactNode {
  const parts = text.split('**');

  if (parts.length < 3) return text;

  return parts.map((part, index) => (index % 2 === 1 ? <strong key={index}>{part}</strong> : part));
}

function MarkdownLite({ content, className }: { content: string; className?: string }) {
  const paragraphs = content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (
    <div className={cn('space-y-2', className)}>
      {paragraphs.map((paragraph, index) => {
        const heading = paragraph.match(/^#{1,6}\s+(.*)$/);

        if (heading) {
          return (
            <p key={index} className="text-sm font-semibold">
              {heading[1]}
            </p>
          );
        }

        return (
          <p key={index} className="whitespace-pre-wrap text-sm leading-relaxed">
            {renderInline(paragraph)}
          </p>
        );
      })}
    </div>
  );
}

function FreshnessBadge({ freshness }: { freshness: DocBlockRow['freshness'] }) {
  if (freshness === 'current') return null;

  const styles: Record<string, string> = {
    stale:
      'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
    regenerating:
      'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-300',
    proposed:
      'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300',
  };

  const labels: Record<string, string> = {
    stale: 'Stale',
    regenerating: 'Regenerating…',
    proposed: 'Proposed update',
  };

  return (
    <Badge variant="outline" className={cn('text-xs font-medium', styles[freshness])}>
      {labels[freshness]}
    </Badge>
  );
}

function BlockCard({
  block,
  selected,
  highlighted,
  busy,
  onSelect,
  onDecide,
}: {
  block: DocBlockRow;
  selected: boolean;
  highlighted: boolean;
  busy: boolean;
  onSelect: () => void;
  onDecide: (decision: 'accept' | 'reject') => void;
}) {
  const hasProposal = block.freshness === 'proposed' && block.proposed_md !== null;
  // Precomputed: `??` inside JSX props miscompiles with this repo's babel
  // setup (assignment to an undeclared helper var), so never inline it there.
  const proposedMd = block.proposed_md === null ? '' : block.proposed_md;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'group cursor-pointer rounded-md border border-transparent px-4 py-3 transition hover:bg-accent/40',
        block.freshness === 'stale' &&
          'border-amber-300 bg-amber-50/40 dark:border-amber-800 dark:bg-amber-950/20',
        block.freshness === 'regenerating' &&
          'animate-pulse border-sky-300 bg-sky-50/40 dark:border-sky-800 dark:bg-sky-950/20',
        hasProposal && 'border-violet-300 dark:border-violet-800',
        highlighted && 'border-blue-400 bg-blue-50/50 dark:border-blue-700 dark:bg-blue-950/20',
        selected && 'outline outline-2 outline-offset-1 outline-primary',
      )}
    >
      {(block.freshness !== 'current' || block.locked) && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <FreshnessBadge freshness={block.freshness} />
          {block.locked ? (
            <Badge variant="outline" className="gap-1 text-xs font-medium">
              <Lock className="size-3" />
              Locked
            </Badge>
          ) : null}
        </div>
      )}

      {hasProposal ? (
        <div onClick={(event) => event.stopPropagation()}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-red-200 bg-red-50/50 p-3 dark:border-red-900 dark:bg-red-950/20">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-400">
                Current
              </p>
              <MarkdownLite content={block.content_md} className="opacity-80" />
            </div>
            <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                Proposed
              </p>
              <MarkdownLite content={proposedMd} />
            </div>
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onDecide('reject')}
            >
              <X />
              Reject
            </Button>
            <Button type="button" size="sm" disabled={busy} onClick={() => onDecide('accept')}>
              <Check />
              Accept
            </Button>
          </div>
        </div>
      ) : (
        <MarkdownLite content={block.content_md} />
      )}
    </div>
  );
}

export function DraftView({
  documentTitle,
  intents,
  blocks,
  pathways,
  regenerating,
  onToggleLock,
  onDecideProposal,
  onPreviewIntentEdit,
  onConfirmIntentEdit,
}: {
  documentTitle: string;
  intents: IntentNodeRow[];
  blocks: DocBlockRow[];
  pathways: PathwayRow[];
  regenerating: boolean;
  onToggleLock: (blockId: string, locked: boolean) => Promise<boolean>;
  onDecideProposal: (blockId: string, decision: 'accept' | 'reject') => Promise<boolean>;
  onPreviewIntentEdit: (
    intentId: string,
    title: string,
    purpose: string,
  ) => Promise<ImpactPreview | null>;
  onConfirmIntentEdit: (intentId: string, title: string, purpose: string) => Promise<boolean>;
}) {
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [highlightedIntentId, setHighlightedIntentId] = useState<string | null>(null);
  const [busyBlockId, setBusyBlockId] = useState<string | null>(null);

  const intentMap = useMemo(() => buildIntentMap(intents), [intents]);

  // Group consecutive blocks under the section_goal ancestor of their intent.
  const sections = useMemo(() => {
    const grouped: Array<{ section: IntentNodeRow | null; blocks: DocBlockRow[] }> = [];

    for (const block of blocks) {
      const intent = intentMap.get(block.intent_node_id);
      const section = sectionFor(intent, intentMap);
      const last = grouped[grouped.length - 1];

      if (last && (last.section?.id ?? null) === (section?.id ?? null)) {
        last.blocks.push(block);
      } else {
        grouped.push({ section, blocks: [block] });
      }
    }

    return grouped;
  }, [blocks, intentMap]);

  const selectedBlock = selectedBlockId
    ? (blocks.find((block) => block.id === selectedBlockId) ?? null)
    : null;
  const selectedIntent = selectedBlock
    ? (intentMap.get(selectedBlock.intent_node_id) ?? null)
    : null;

  const handleDecide = async (blockId: string, decision: 'accept' | 'reject') => {
    setBusyBlockId(blockId);
    await onDecideProposal(blockId, decision);
    setBusyBlockId(null);
  };

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      {/* Document */}
      <div className="min-w-0 flex-1">
        <article className="rounded-lg border bg-card px-2 py-6 shadow-sm sm:px-6">
          <h1 className="mb-6 px-4 text-2xl font-semibold tracking-tight">{documentTitle}</h1>
          <div className="space-y-6">
            {sections.map((group, index) => {
              // Precomputed: `??` inside the key prop miscompiles with this
              // repo's babel setup (assignment to an undeclared _ref helper).
              const sectionKey = group.section ? group.section.id : `preamble-${index}`;

              return (
                <section key={sectionKey}>
                  {group.section ? (
                    <h2 className="mb-2 flex items-center gap-2 px-4 text-lg font-semibold tracking-tight">
                      {group.section.title}
                      {group.section.status === 'stale' ? (
                        <span
                          className="size-2 rounded-full bg-amber-500"
                          title="This section's intent is stale"
                        />
                      ) : null}
                    </h2>
                  ) : null}
                  <div className="space-y-1">
                    {group.blocks.map((block) => (
                      <BlockCard
                        key={block.id}
                        block={block}
                        selected={selectedBlockId === block.id}
                        highlighted={
                          highlightedIntentId !== null &&
                          block.intent_node_id === highlightedIntentId
                        }
                        busy={busyBlockId === block.id}
                        onSelect={() => {
                          setHighlightedIntentId(null);
                          setSelectedBlockId((prev) => (prev === block.id ? null : block.id));
                        }}
                        onDecide={(decision) => handleDecide(block.id, decision)}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </article>
      </div>

      {/* Intent lens / outline */}
      <aside className="w-full shrink-0 lg:w-[360px]">
        <div className="rounded-lg border bg-card p-4 shadow-sm lg:sticky lg:top-6">
          {selectedBlock && selectedIntent ? (
            <IntentLens
              key={`${selectedBlock.id}-${selectedIntent.id}`}
              block={selectedBlock}
              intent={selectedIntent}
              intents={intents}
              pathways={pathways}
              regenerating={regenerating}
              onToggleLock={onToggleLock}
              onPreviewIntentEdit={onPreviewIntentEdit}
              onConfirmIntentEdit={onConfirmIntentEdit}
            />
          ) : (
            <IntentOutline
              intents={intents}
              highlightedIntentId={highlightedIntentId}
              onHighlight={(intentId) => {
                setSelectedBlockId(null);
                setHighlightedIntentId(intentId);
              }}
            />
          )}
        </div>
      </aside>
    </div>
  );
}
