'use client';

import { Lock } from 'lucide-react';

import type { ImpactPreview } from '@/lib/studio/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function ImpactPreviewModal({
  preview,
  open,
  confirming,
  onOpenChange,
  onConfirm,
}: {
  preview: ImpactPreview | null;
  open: boolean;
  confirming: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const affectedIntents = preview?.affectedIntents ?? [];
  const affectedBlocks = preview?.affectedBlocks ?? [];
  const lockedCount = affectedBlocks.filter((block) => block.locked).length;
  const regenCount = affectedBlocks.length - lockedCount;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Impact of this intent change</DialogTitle>
          <DialogDescription>
            {regenCount} block{regenCount === 1 ? '' : 's'} will be regenerated
            {lockedCount > 0
              ? `; ${lockedCount} locked block${lockedCount === 1 ? ' is' : 's are'} excluded`
              : ''}
            . Nothing is overwritten — new text arrives as proposals you accept or reject.
          </DialogDescription>
        </DialogHeader>

        {affectedIntents.length > 0 ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Affected intents
            </p>
            <ul className="mt-2 space-y-2">
              {affectedIntents.map((intent) => (
                <li key={intent.id} className="rounded-md border px-3 py-2">
                  <p className="text-sm font-medium">{intent.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{intent.reason}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Affected blocks
          </p>
          {affectedBlocks.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No blocks are affected by this change.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {affectedBlocks.map((block) => (
                <li
                  key={block.id}
                  className={
                    block.locked ? 'rounded-md border px-3 py-2 opacity-60' : 'rounded-md border px-3 py-2'
                  }
                >
                  <p className="line-clamp-2 text-sm text-muted-foreground">{block.excerpt}</p>
                  {block.locked ? (
                    <Badge variant="outline" className="mt-1.5 gap-1 text-xs font-medium">
                      <Lock className="size-3" />
                      Locked — excluded from regeneration
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={confirming}>
            {confirming ? 'Applying…' : 'Confirm & regenerate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
