'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Check } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/utils';

import { ProgressPanel } from './ProgressPanel';
import type { PathwayRow } from './useStudio';

function DetailList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-muted-foreground">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function PathwayCard({
  pathway,
  disabled,
  onSelect,
}: {
  pathway: PathwayRow;
  disabled: boolean;
  onSelect: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { payload } = pathway;

  return (
    <div
      className={cn(
        'flex flex-col rounded-lg border bg-card p-5 shadow-sm transition hover:shadow-md',
        pathway.selected && 'ring-2 ring-primary',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold leading-snug">{payload.title}</h3>
        <Badge variant="secondary" className="shrink-0 font-normal">
          {payload.tone}
        </Badge>
      </div>

      <p className="mt-2 text-sm text-muted-foreground">{payload.oneSentenceApproach}</p>

      <div className="mt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Thesis
        </p>
        <p className="mt-1 text-sm">{payload.thesis}</p>
      </div>

      <div className="mt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Structure
        </p>
        <ol className="mt-1 space-y-1 text-sm">
          {payload.structure.map((section, index) => (
            <li key={index} className="flex gap-2">
              <span className="w-4 shrink-0 text-right text-xs font-medium text-muted-foreground">
                {index + 1}.
              </span>
              <span className="min-w-0">{section}</span>
            </li>
          ))}
        </ol>
      </div>

      {expanded ? (
        <div className="mt-4 space-y-3 border-t pt-4">
          <DetailList label="Assumptions" items={payload.assumptions} />
          <DetailList label="Tradeoffs" items={payload.tradeoffs} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              How it differs from the others
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{payload.differenceFromOthers}</p>
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between gap-2 pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((prev) => !prev)}
          className="text-muted-foreground"
        >
          {expanded ? <ChevronUp /> : <ChevronDown />}
          {expanded ? 'Less detail' : 'More detail'}
        </Button>
        <Button type="button" size="sm" disabled={disabled} onClick={onSelect}>
          <Check />
          Select this pathway
        </Button>
      </div>
    </div>
  );
}

export function PathwayGrid({
  pathways,
  generatingDraft,
  onSelect,
}: {
  pathways: PathwayRow[];
  generatingDraft: boolean;
  onSelect: (pathwayId: string) => void;
}) {
  if (generatingDraft) {
    return (
      <div className="mx-auto max-w-2xl">
        <ProgressPanel
          message="Turning the pathway into an intent graph and draft…"
          hint="Every block of the draft will be causally linked to an intent node. This usually takes 30-60 seconds."
        />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold tracking-tight">Choose a pathway</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {pathways.length} distinct strategies for your brief. Pick the one whose reasoning you
          buy — the draft inherits its thesis, structure and tone.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {pathways.map((pathway) => (
          <PathwayCard
            key={pathway.id}
            pathway={pathway}
            disabled={generatingDraft}
            onSelect={() => onSelect(pathway.id)}
          />
        ))}
      </div>
    </div>
  );
}
