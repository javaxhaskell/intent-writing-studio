import { createClient } from '@/lib/supabase/client';
import type { DocumentPermissionData } from '@/services/document/type';

/**
 * Supabase-backed document access bootstrap for the /docs/[room] editor gate.
 *
 * Replaces the legacy `GET /api/v1/documents/:id/permissions` call
 * (DocumentApi.GetDocumentPermissions). Access is resolved by the
 * SECURITY DEFINER RPC `public.get_document_access`
 * (supabase/migrations/20260718000003_document_access.sql): at most one row of
 * { role, can_edit, can_comment }; ZERO rows uniformly mean not found / not a
 * member / soft-deleted (no existence oracle).
 *
 * The Hocuspocus `server:permission` stateless message remains the
 * authoritative runtime read-only flag (see useCollaboration); this module
 * only feeds the HTTP-era bootstrap contract consumed by the page.
 */

/** One row of public.get_document_access (zero rows = no access). */
export interface DocumentAccessRow {
  role: string;
  can_edit: boolean;
  can_comment: boolean;
}

/** The identity fields the collaboration UI needs from the Supabase session. */
export interface DocumentAccessUser {
  id: string;
  name: string;
  avatar: string;
}

/**
 * Pure adapter: RPC rows + session user + RLS-scoped title -> the legacy
 * DocumentPermissionData shape, so /docs/[room]/page.tsx and useCollaboration
 * keep working with zero edits.
 *
 * Capability -> legacy enum mapping:
 *   zero rows                  -> 'NONE'
 *   can_edit                   -> 'EDIT'
 *   !can_edit && can_comment   -> 'COMMENT'
 *   otherwise                  -> 'VIEW'
 */
export function mapAccessToPermissionData(
  documentId: string,
  rows: readonly DocumentAccessRow[],
  user: DocumentAccessUser,
  documentTitle: string,
): DocumentPermissionData {
  const access = rows.length > 0 ? rows[0] : null;

  const permission: DocumentPermissionData['permission'] =
    access === null ? 'NONE' : access.can_edit ? 'EDIT' : access.can_comment ? 'COMMENT' : 'VIEW';

  // DocumentPermissionData predates the Supabase move and still types
  // documentId/userId as number, while the room param and auth.uid() are uuid
  // strings now. Every live consumer (useDocumentPermission,
  // /docs/[room]/page.tsx, useCollaboration — grep-verified) reads
  // permission/username/avatar/documentTitle or calls userId.toString(), so
  // carrying uuid strings through the legacy shape is runtime-safe. The cast
  // below is confined to this adapter and disappears when the legacy type is
  // retired together with DocumentApi.GetDocumentPermissions.
  const data: Omit<DocumentPermissionData, 'documentId' | 'userId'> & {
    documentId: string;
    userId: string;
  } = {
    documentId,
    userId: user.id,
    username: user.name,
    avatar: user.avatar,
    documentTitle,
    documentType: 'FILE',
    isOwner: access?.role === 'owner',
    permission,
  };

  return data as unknown as DocumentPermissionData;
}

/**
 * Fetches the caller's access to a document plus the identity/title metadata
 * the editor shell needs, in one parallel round-trip:
 *   - public.get_document_access RPC (capabilities; definer, zero rows = NONE)
 *   - supabase.auth.getUser()        (userId/username/avatar)
 *   - documents.title                (RLS-scoped; empty when not visible)
 */
export async function getDocumentAccess(documentId: string): Promise<{
  data: DocumentPermissionData | null;
  error: string | null;
}> {
  const supabase = createClient();

  const [accessResult, userResult, titleResult] = await Promise.all([
    // Cast: src/types/database.ts has not been regenerated since the
    // get_document_access migration landed; `as never` keeps this compiling
    // both before and after that regeneration.
    supabase.rpc(
      'get_document_access' as never,
      {
        p_document_id: documentId,
      } as never,
    ) as unknown as Promise<{
      data: DocumentAccessRow[] | null;
      error: { message: string } | null;
    }>,
    supabase.auth.getUser(),
    supabase.from('documents').select('title').eq('id', documentId).maybeSingle(),
  ]);

  const user = userResult.data.user;

  if (userResult.error || !user) {
    return { data: null, error: '未登录或登录已过期，请重新登录后再访问文档' };
  }

  if (accessResult.error) {
    return { data: null, error: accessResult.error.message };
  }

  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const name =
    pickNonBlankString(metadata.name) ??
    pickNonBlankString(metadata.full_name) ??
    pickNonBlankString(metadata.user_name) ??
    user.email ??
    user.id;
  const avatar = pickNonBlankString(metadata.avatar_url) ?? '';

  return {
    data: mapAccessToPermissionData(
      documentId,
      accessResult.data ?? [],
      { id: user.id, name, avatar },
      titleResult.data?.title ?? '',
    ),
    error: null,
  };
}

function pickNonBlankString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}
