import { createHash } from 'crypto';

import type { Database } from '@/types/database';
import type { DocBlockRow, IntentNodeRow, IntentKind } from '@/lib/studio/contracts';

import { GatewayError } from '@/lib/studio/gateway';
import { createClient } from '@/lib/supabase/server';

export type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type DbIntentNode = Database['public']['Tables']['intent_nodes']['Row'];
type DbDocBlock = Database['public']['Tables']['doc_blocks']['Row'];

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function jsonError(status: number, error: string, details?: unknown) {
  return Response.json(details === undefined ? { error } : { error, details }, { status });
}

/** Maps thrown route errors to responses without leaking internals. */
export function handleRouteError(err: unknown) {
  if (err instanceof GatewayError) {
    console.error(`[studio] gateway error (${err.kind}):`, err.message);

    if (err.kind === 'config') {
      return jsonError(500, 'Model provider is not configured on the server');
    }

    return jsonError(502, `Model call failed: ${err.message}`);
  }

  console.error('[studio] unexpected route error:', err);

  return jsonError(500, 'Internal server error');
}

/**
 * Creates the RLS-scoped server client and resolves the current user.
 * Returns null user when unauthenticated (route should 401).
 */
export async function getAuthContext(): Promise<{
  supabase: SupabaseServerClient;
  userId: string | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabase, userId: user?.id ?? null };
}

/**
 * RLS-scoped document lookup — this is the tenancy gate: a row only comes
 * back when the user is a member of the owning organization.
 */
export async function getDocumentForUser(supabase: SupabaseServerClient, documentId: string) {
  const { data, error } = await supabase
    .from('documents')
    .select('id, organization_id')
    .eq('id', documentId)
    .maybeSingle();

  if (error) {
    console.error('[studio] document lookup failed:', error.message);

    return null;
  }

  return data;
}

export function toIntentRow(row: DbIntentNode): IntentNodeRow {
  return {
    id: row.id,
    parent_id: row.parent_id,
    kind: row.kind as IntentKind,
    title: row.title,
    purpose: row.purpose,
    position: row.position,
    status: row.status as IntentNodeRow['status'],
    pathway_id: row.pathway_id,
  };
}

export function toBlockRow(row: DbDocBlock): DocBlockRow {
  return {
    id: row.id,
    intent_node_id: row.intent_node_id,
    position: row.position,
    content_md: row.content_md,
    proposed_md: row.proposed_md,
    freshness: row.freshness as DocBlockRow['freshness'],
    locked: row.locked,
  };
}
