'use client';

import { useState } from 'react';
import { ChevronRight, Lock, LockOpen, Route } from 'lucide-react';

import type { DocBlockRow, ImpactPreview, IntentNodeRow } from '@/lib/studio/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/utils';

import { ImpactPreviewModal } from './ImpactPreviewModal';
import { ancestorChain, KIND_BADGE_CLASSES, KIND_LABELS } from './intent-utils';
import type { PathwayRow } from './useStudio';

export function IntentLens({
  block,
  intent,
  intents,
  pathways,
  regenerating,
  onToggleLock,
  onPreviewIntentEdit,
  onConfirmIntentEdit,
}: {
  block: DocBlockRow;
  intent: IntentNodeRow;
  intents: IntentNodeRow[];
  pathways: PathwayRow[];
  regenerating: boolean;
  onToggleLock: (blockId: string, locked: boolean) => Promise<boolean>;
  onPreviewIntentEdit: (
    intentId: string,
    title: string,
    purpose: string,
  ) => Promise<ImpactPreview | null>;
  onConfirmIntentEdit: (intentId: string, title: string, purpose: string) => Promise<boolean>;
}) {
  const [title, setTitle] = useState(intent.title);
  const [purpose, setPurpose] = useState(intent.purpose);
  const [preview, setPreview] = useState<ImpactPreview | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);

  const intentMap = new Map(intents.map((node) => [node.id, node]));
  const chain = ancestorChain(intent, intentMap);
  const selectedPathway = pathways.find((pathway) => pathway.selected) ?? null;
  const dirty = title !== intent.title || purpose !== intent.purpose;

  const handlePreview = async () => {
    if (!title.trim() || !purpose.trim()) return;

    setPreviewing(true);

    const result = await onPreviewIntentEdit(intent.id, title.trim(), purpose.trim());
    setPreviewing(false);

    if (result) {
      setPreview(result);
      setModalOpen(true);
    }
  };

  const handleConfirm = async () => {
    setModalOpen(false);

    await onConfirmIntentEdit(intent.id, title.trim(), purpose.trim());
  };

  const handleToggleLock = async () => {
    setLockBusy(true);
    await onToggleLock(block.id, !block.locked);
    setLockBusy(false);
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={cn('font-medium', KIND_BADGE_CLASSES[intent.kind])}>
            {KIND_LABELS[intent.kind]}
          </Badge>
          <Badge
            variant="outline"
            className={cn(
              'font-medium',
              intent.status === 'stale'
                ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                : 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
            )}
          >
            {intent.status === 'stale' ? 'Stale' : 'Current'}
          </Badge>
        </div>
        <h3 className="mt-2 text-sm font-semibold">{intent.title}</h3>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Why this block exists
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{intent.purpose}</p>
      </div>

      {selectedPathway ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Pathway provenance
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-sm">
            <Route className="size-3.5 shrink-0 text-muted-foreground" />
            {selectedPathway.payload.title}
          </p>
        </div>
      ) : null}

      {chain.length > 0 ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Depends on
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            {chain.map((ancestor, index) => (
              <span key={ancestor.id} className="flex items-center gap-1">
                {index > 0 ? <ChevronRight className="size-3 shrink-0" /> : null}
                <span className="max-w-[180px] truncate" title={ancestor.title}>
                  {ancestor.title}
                </span>
              </span>
            ))}
            <ChevronRight className="size-3 shrink-0" />
            <span className="font-medium text-foreground">this intent</span>
          </div>
        </div>
      ) : null}

      <div className="border-t pt-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleToggleLock}
          disabled={lockBusy || regenerating}
          className="w-full"
        >
          {block.locked ? <LockOpen /> : <Lock />}
          {block.locked ? 'Unlock block' : 'Lock block'}
        </Button>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Locked blocks are never touched by regeneration.
        </p>
      </div>

      <div className="border-t pt-4">
        <p className="text-sm font-semibold">Edit intent</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Change what this part of the document is trying to do — then preview exactly which
          blocks are affected before anything regenerates.
        </p>

        <label htmlFor="intent-title" className="mt-3 block text-xs font-medium">
          Title
        </label>
        <input
          id="intent-title"
          value={title}
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />

        <label htmlFor="intent-purpose" className="mt-3 block text-xs font-medium">
          Purpose
        </label>
        <textarea
          id="intent-purpose"
          rows={4}
          value={purpose}
          maxLength={600}
          onChange={(event) => setPurpose(event.target.value)}
          className="mt-1 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />

        <Button
          type="button"
          size="sm"
          className="mt-3 w-full"
          disabled={!dirty || !title.trim() || !purpose.trim() || previewing || regenerating}
          onClick={handlePreview}
        >
          {previewing ? 'Analyzing impact…' : 'Preview impact'}
        </Button>
      </div>

      <ImpactPreviewModal
        preview={preview}
        open={modalOpen}
        confirming={regenerating}
        onOpenChange={setModalOpen}
        onConfirm={handleConfirm}
      />
    </div>
  );
}
