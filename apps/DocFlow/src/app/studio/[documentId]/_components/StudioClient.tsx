'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { BriefForm } from './BriefForm';
import { DraftView } from './DraftView';
import { PathwayGrid } from './PathwayGrid';
import { ProgressPanel } from './ProgressPanel';
import { useStudio, type StudioStep } from './useStudio';

import { cn } from '@/utils';
import { Button } from '@/components/ui/button';

const STEPS: Array<{ id: StudioStep; label: string }> = [
  { id: 'brief', label: 'Brief' },
  { id: 'pathways', label: 'Pathways' },
  { id: 'draft', label: 'Draft' },
];

function StepIndicator({ current }: { current: StudioStep }) {
  const currentIndex = STEPS.findIndex((step) => step.id === current);

  return (
    <ol className="flex items-center gap-2 text-xs">
      {STEPS.map((step, index) => (
        <li key={step.id} className="flex items-center gap-2">
          {index > 0 ? <span className="h-px w-5 bg-border" /> : null}
          <span
            className={cn(
              'rounded-full border px-2.5 py-0.5 font-medium',
              index === currentIndex
                ? 'border-primary bg-primary text-primary-foreground'
                : index < currentIndex
                  ? 'border-primary/40 text-primary'
                  : 'text-muted-foreground',
            )}
          >
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function StudioClient({
  documentId,
  documentTitle,
}: {
  documentId: string;
  documentTitle: string;
}) {
  const studio = useStudio(documentId);

  return (
    // The root layout pins body/main to h-full with no page scroll, so the
    // studio owns its scroll container.
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="ghost" size="icon" aria-label="Back to Studio">
              <Link href="/studio">
                <ArrowLeft />
              </Link>
            </Button>
            <h1 className="truncate text-lg font-semibold tracking-tight">{documentTitle}</h1>
          </div>
          <StepIndicator current={studio.step} />
        </header>

        {studio.loading ? (
          <div className="mx-auto max-w-2xl space-y-3">
            <div className="h-24 animate-pulse rounded-lg border bg-muted/40" />
            <div className="h-24 animate-pulse rounded-lg border bg-muted/40" />
          </div>
        ) : studio.loadError ? (
          <div className="mx-auto max-w-2xl rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Failed to load this document: {studio.loadError}
          </div>
        ) : studio.step === 'brief' ? (
          <BriefForm generating={studio.generatingPathways} onSubmit={studio.generatePathways} />
        ) : studio.step === 'pathways' ? (
          <PathwayGrid
            pathways={studio.pathways}
            generatingDraft={studio.generatingDraft}
            onSelect={studio.selectPathway}
          />
        ) : (
          <DraftView
            documentTitle={documentTitle}
            intents={studio.intents}
            blocks={studio.blocks}
            pathways={studio.pathways}
            regenerating={studio.regenerating}
            onToggleLock={studio.setBlockLock}
            onDecideProposal={studio.decideProposal}
            onPreviewIntentEdit={studio.previewIntentEdit}
            onConfirmIntentEdit={studio.applyIntentEditAndRegenerate}
          />
        )}

        {studio.regenerating ? (
          <div className="fixed bottom-6 right-6 z-50 w-80 max-w-[calc(100vw-3rem)]">
            <ProgressPanel
              message="Regenerating only the affected blocks…"
              hint="Locked blocks are untouched. New text arrives as proposals to accept or reject."
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
