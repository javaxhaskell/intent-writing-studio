'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import type {
  Brief,
  DocBlockRow,
  ImpactPreview,
  IntentNodeRow,
  PathwayPayload,
} from '@/lib/studio/contracts';

export interface PathwayRow {
  id: string;
  rank: number;
  selected: boolean;
  payload: PathwayPayload;
}

export interface PathwaySetRow {
  id: string;
  status: string;
  created_at: string;
}

export type StudioStep = 'brief' | 'pathways' | 'draft';

async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;

    try {
      const data = (await res.json()) as { error?: unknown };
      if (data && typeof data.error === 'string') message = data.error;
    } catch {
      // Non-JSON error body — keep the status message.
    }

    throw new Error(message);
  }

  return res.json().catch(() => ({}) as T) as Promise<T>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong';
}

/**
 * One simple fetch-and-refresh store for the studio experience.
 * All reads go through the RLS-scoped browser Supabase client; all writes go
 * through /api/studio/* route handlers, followed by a full refresh.
 */
export function useStudio(documentId: string) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pathwaySet, setPathwaySet] = useState<PathwaySetRow | null>(null);
  const [pathways, setPathways] = useState<PathwayRow[]>([]);
  const [intents, setIntents] = useState<IntentNodeRow[]>([]);
  const [blocks, setBlocks] = useState<DocBlockRow[]>([]);

  const [generatingPathways, setGeneratingPathways] = useState(false);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const refresh = useCallback(async () => {
    const supabase = createClient();

    const [setRes, intentRes, blockRes] = await Promise.all([
      supabase
        .from('pathway_sets')
        .select('id,status,created_at')
        .eq('document_id', documentId)
        .order('created_at', { ascending: false })
        .limit(1),
      supabase
        .from('intent_nodes')
        .select('id,parent_id,kind,title,purpose,position,status,pathway_id')
        .eq('document_id', documentId)
        .order('position', { ascending: true }),
      supabase
        .from('doc_blocks')
        .select('id,intent_node_id,position,content_md,proposed_md,freshness,locked')
        .eq('document_id', documentId)
        .order('position', { ascending: true }),
    ]);

    const firstError = setRes.error ?? intentRes.error ?? blockRes.error;
    if (firstError) throw new Error(firstError.message);

    const latestSet = (setRes.data?.[0] ?? null) as PathwaySetRow | null;

    let pathwayRows: PathwayRow[] = [];

    if (latestSet) {
      const { data, error } = await supabase
        .from('pathways')
        .select('id,rank,selected,payload')
        .eq('pathway_set_id', latestSet.id)
        .order('rank', { ascending: true });

      if (error) throw new Error(error.message);

      pathwayRows = (data ?? []).map((row) => ({
        id: row.id,
        rank: row.rank,
        selected: row.selected,
        payload: row.payload as PathwayPayload,
      }));
    }

    setPathwaySet(latestSet);
    setPathways(pathwayRows);
    setIntents((intentRes.data ?? []) as IntentNodeRow[]);
    setBlocks((blockRes.data ?? []) as DocBlockRow[]);
  }, [documentId]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setLoadError(null);

      try {
        await refresh();
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const generatePathways = useCallback(
    async (brief: Brief): Promise<boolean> => {
      setGeneratingPathways(true);

      try {
        await postJson('/api/studio/pathways', { documentId, brief });
        await refresh();

        return true;
      } catch (err) {
        toast.error(errorMessage(err));

        return false;
      } finally {
        setGeneratingPathways(false);
      }
    },
    [documentId, refresh],
  );

  const selectPathway = useCallback(
    async (pathwayId: string): Promise<boolean> => {
      setGeneratingDraft(true);

      try {
        await postJson('/api/studio/draft', { documentId, pathwayId });
        await refresh();

        return true;
      } catch (err) {
        toast.error(errorMessage(err));

        return false;
      } finally {
        setGeneratingDraft(false);
      }
    },
    [documentId, refresh],
  );

  const previewIntentEdit = useCallback(
    async (intentId: string, title: string, purpose: string): Promise<ImpactPreview | null> => {
      try {
        return await postJson<ImpactPreview>('/api/studio/intent', {
          intentId,
          title,
          purpose,
          previewOnly: true,
        });
      } catch (err) {
        toast.error(errorMessage(err));

        return null;
      }
    },
    [],
  );

  const applyIntentEditAndRegenerate = useCallback(
    async (intentId: string, title: string, purpose: string): Promise<boolean> => {
      setRegenerating(true);

      try {
        await postJson('/api/studio/intent', { intentId, title, purpose, previewOnly: false });
        // Show the stale/regenerating states while the model call runs.
        await refresh();
        await postJson('/api/studio/regenerate', { documentId });
        await refresh();

        return true;
      } catch (err) {
        toast.error(errorMessage(err));
        await refresh().catch(() => undefined);

        return false;
      } finally {
        setRegenerating(false);
      }
    },
    [documentId, refresh],
  );

  const decideProposal = useCallback(
    async (blockId: string, decision: 'accept' | 'reject'): Promise<boolean> => {
      try {
        await postJson('/api/studio/proposal', { blockId, decision });
        await refresh();

        return true;
      } catch (err) {
        toast.error(errorMessage(err));

        return false;
      }
    },
    [refresh],
  );

  const setBlockLock = useCallback(
    async (blockId: string, locked: boolean): Promise<boolean> => {
      try {
        await postJson('/api/studio/block-lock', { blockId, locked });
        await refresh();

        return true;
      } catch (err) {
        toast.error(errorMessage(err));

        return false;
      }
    },
    [refresh],
  );

  const step: StudioStep = blocks.length > 0 ? 'draft' : pathways.length > 0 ? 'pathways' : 'brief';

  return {
    loading,
    loadError,
    step,
    pathwaySet,
    pathways,
    intents,
    blocks,
    generatingPathways,
    generatingDraft,
    regenerating,
    refresh,
    generatePathways,
    selectPathway,
    previewIntentEdit,
    applyIntentEditAndRegenerate,
    decideProposal,
    setBlockLock,
  };
}

export type StudioState = ReturnType<typeof useStudio>;
