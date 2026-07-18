'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Progress } from '@/components/ui/progress';
import { cn } from '@/utils';

/**
 * Optimistic progress for long-running model calls (30-60s). The bar eases
 * toward ~92% and only the completion of the request finishes it, so it never
 * lies about being done.
 */
export function ProgressPanel({
  message,
  hint,
  className,
}: {
  message: string;
  hint?: string;
  className?: string;
}) {
  const [value, setValue] = useState(4);

  useEffect(() => {
    const startedAt = Date.now();

    const interval = setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000;
      // Fast at first, asymptotically approaching 92% around the 60s mark.
      const next = Math.min(92, 100 * (1 - Math.exp(-elapsed / 22)));
      setValue(next);
    }, 400);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className={cn('rounded-lg border bg-card p-6 shadow-sm', className)}>
      <div className="flex items-center gap-3">
        <Loader2 className="size-5 shrink-0 animate-spin text-primary" />
        <div className="min-w-0">
          <p className="text-sm font-medium">{message}</p>
          {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
      </div>
      <Progress value={value} className="mt-4 h-2" />
    </div>
  );
}
