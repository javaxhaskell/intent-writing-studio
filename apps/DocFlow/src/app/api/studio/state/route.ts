import {
  getAuthContext,
  getDocumentForUser,
  jsonError,
  handleRouteError,
  toIntentRow,
  toBlockRow,
} from '../_lib/helpers';

export const maxDuration = 60;

/**
 * GET /api/studio/state?documentId=...
 *
 * Read-only bootstrap for the theem frontend: the document, its intent
 * graph, blocks, and the latest pathway set in one round-trip. RLS scopes
 * everything to the caller's organizations.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const documentId = url.searchParams.get('documentId') ?? '';

    if (!/^[0-9a-f-]{36}$/i.test(documentId)) {
      return jsonError(400, 'documentId must be a uuid');
    }

    const { supabase, userId } = await getAuthContext();

    if (!userId) return jsonError(401, 'Not signed in');

    const doc = await getDocumentForUser(supabase, documentId);

    if (!doc) return jsonError(404, 'Document not found');

    const [docRow, intents, blocks, sets] = await Promise.all([
      supabase.from('documents').select('id, title').eq('id', documentId).single(),
      supabase
        .from('intent_nodes')
        .select('*')
        .eq('document_id', documentId)
        .order('position', { ascending: true }),
      supabase
        .from('doc_blocks')
        .select('*')
        .eq('document_id', documentId)
        .order('position', { ascending: true }),
      supabase
        .from('pathway_sets')
        .select('id, status, created_at, pathways ( id, payload, rank, selected )')
        .eq('document_id', documentId)
        .order('created_at', { ascending: false })
        .limit(1),
    ]);

    const set = sets.data?.[0] ?? null;
    const pathways = (set?.pathways ?? [])
      .slice()
      .sort((a, b) => a.rank - b.rank)
      .map((p) => ({ id: p.id, rank: p.rank, selected: p.selected, payload: p.payload }));

    return Response.json({
      document: { id: documentId, title: docRow.data?.title ?? 'Untitled' },
      intents: (intents.data ?? []).map(toIntentRow),
      blocks: (blocks.data ?? []).map(toBlockRow),
      pathwaySet: set ? { id: set.id, status: set.status } : null,
      pathways,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
