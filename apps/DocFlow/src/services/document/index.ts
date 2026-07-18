import { JSONContent } from '@tiptap/core';

import type { ErrorHandler, RequestResult } from '../request';
import {
  CreateDocumentDto,
  DocumentResponse,
  GetDocumentsResponse,
  CreateShareLinkDto,
  ShareLinkResponse,
  DeleteDocumentDto,
  RenameDocumentDto,
  DuplicateDocumentDto,
  AccessSharedDocumentDto,
  AccessSharedDocumentResponse,
  SharedDocumentItem,
  DocumentPermissionData,
  LatestDocumentItem,
  DocumentItem,
  DocumentOrganization,
  OrganizationDocumentGroup,
} from './type';

import { createClient } from '@/lib/supabase/client';

/**
 * Supabase-backed DocumentApi.
 *
 * Replaces the legacy `/api/v1/documents*` HTTP endpoints with RLS-scoped
 * queries through the typed browser client (anon key + the signed-in user's
 * JWT — never the service role). Follows the adapter precedent set by
 * services/document/access.ts: every method keeps the legacy
 * `RequestResult<T>` envelope ({ data: { code, message, data, timestamp },
 * error }) so the envelope checks at every call site keep working unchanged.
 *
 * Data model today (supabase/migrations/20260718000001_tenancy.sql):
 * documents(id uuid, project_id, organization_id, title, kind, deleted_at,
 * created_at, updated_at). There is NO parent_id/type/sort_order/is_starred,
 * no share-link tables and no org-less "personal" documents, so those
 * features are explicit stubs below, clearly marked "awaiting milestone".
 */

// ---------------------------------------------------------------------------
// Envelope helpers (legacy {code,message,data,timestamp} contract)
// ---------------------------------------------------------------------------

function ok<T>(data: T, message = 'success', code = 200): RequestResult<T> {
  return {
    data: { code, message, data, timestamp: Date.now() },
    error: null,
  };
}

function fail<T>(message: string, errorHandler?: ErrorHandler, status?: number): RequestResult<T> {
  notifyError(errorHandler, new Error(message));

  return { data: null, error: message, status };
}

function notifyError(errorHandler: ErrorHandler | undefined, error: unknown): void {
  if (typeof errorHandler === 'function') {
    errorHandler(error);
  } else if (errorHandler?.onError) {
    errorHandler.onError(error);
  }
}

/**
 * PostgREST reports "zero rows for .single()" as code PGRST116. Under RLS
 * that uniformly means "not found OR not yours OR no write policy matched" —
 * surface it as one friendly message (no existence oracle).
 */
function writeErrorMessage(error: { code?: string; message: string }): string {
  return error.code === 'PGRST116' ? '文档不存在或没有操作权限' : error.message;
}

// ---------------------------------------------------------------------------
// Row -> legacy DocumentItem adapter
// ---------------------------------------------------------------------------

interface DocumentListRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  organization_id: string;
  project_id: string;
}

function toDocumentItem(row: DocumentListRow, organization: DocumentOrganization): DocumentItem {
  return {
    id: row.id,
    title: row.title,
    // Awaiting folder-tree milestone: documents has no parent_id/type columns,
    // so every row is a flat FILE at the group root.
    type: 'FILE',
    parent_id: null,
    // Awaiting sort_order column.
    sort_order: 0,
    // Awaiting favorites milestone.
    is_starred: false,
    created_at: row.created_at,
    updated_at: row.updated_at,
    // Documents are org-scoped, not user-owned; there is no owner column.
    owner_id: '',
    organization_id: row.organization_id,
    owner: { id: '', name: null, avatar_url: null },
    organization,
    // Not consumed by any live list UI; real per-document gating happens at
    // open time via the get_document_access RPC (services/document/access.ts).
    permission: 'VIEW',
  };
}

export const DocumentApi = {
  /**
   * Document list for the /docs sidebar.
   *
   * One RLS-scoped read per source, in parallel:
   *  - organizations: only orgs the caller is a member of are visible, so the
   *    group list (including empty orgs) falls out of RLS with no extra
   *    membership query — this replaces the legacy GET /api/v1/organizations
   *    parallel call in fileStore.loadFiles.
   *  - documents: only docs in those orgs are visible. `deleted_at` must be
   *    filtered client-side because owners/admins can still SELECT
   *    soft-deleted rows (restore path).
   *
   * `personal` and `shared` stay empty stubs: there are no org-less documents
   * and no share tables yet (awaiting their milestones).
   */
  GetDocument: async (errorHandler?: ErrorHandler): Promise<RequestResult<GetDocumentsResponse>> => {
    const supabase = createClient();

    const [orgsResult, docsResult] = await Promise.all([
      supabase.from('organizations').select('id, name').is('deleted_at', null).order('name'),
      supabase
        .from('documents')
        .select('id, title, created_at, updated_at, organization_id, project_id')
        .is('deleted_at', null)
        .order('updated_at', { ascending: false }),
    ]);

    if (orgsResult.error) return fail(orgsResult.error.message, errorHandler);
    if (docsResult.error) return fail(docsResult.error.message, errorHandler);

    const groups: OrganizationDocumentGroup[] = orgsResult.data.map((org) => ({
      id: org.id,
      name: org.name,
      documents: [],
    }));
    const groupById = new Map(groups.map((group) => [group.id, group]));

    for (const row of docsResult.data) {
      const group = groupById.get(row.organization_id);
      // A visible doc whose org row is not visible (org soft-deleted) has no
      // group to live in — drop it rather than fabricate a nameless group.
      if (!group) continue;

      group.documents.push(toDocumentItem(row, { id: group.id, name: group.name }));
    }

    return ok<GetDocumentsResponse>({
      personal: [], // stub — awaiting personal (org-less) workspace milestone
      organizations: groups,
      shared: [], // stub — awaiting share-links milestone
      total: docsResult.data.length,
    });
  },

  /**
   * Superseded by services/document/access.ts (get_document_access RPC), which
   * every live consumer already uses. Kept only for the legacy signature.
   */
  GetDocumentPermissions: (
    _documentId: number | string,
    errorHandler?: ErrorHandler,
  ): Promise<RequestResult<DocumentPermissionData>> =>
    Promise.resolve(
      fail('该接口已由 get_document_access 取代（services/document/access.ts）', errorHandler),
    ),

  /**
   * Create a document inside an organization: resolve the org's project (each
   * seeded org has exactly one) and insert. RLS gates the insert to
   * owner/admin/editor members.
   *
   * Not yet supported (marked stubs, awaiting their milestones):
   *  - org-less "personal" documents (no backing table);
   *  - FOLDER type / parent_id (no folder-tree columns);
   *  - initial content (content lives in Yjs/document_versions, not here —
   *    TemplatesTab hands template content over via localStorage).
   */
  CreateDocument: async (
    data: CreateDocumentDto,
    errorHandler?: ErrorHandler,
  ): Promise<RequestResult<DocumentResponse>> => {
    if (data.type === 'FOLDER') {
      return fail('文件夹功能暂未开放（等待目录树数据模型）', errorHandler);
    }

    if (!data.organization_id) {
      return fail('个人文档暂未开放，请在组织分组中创建文档', errorHandler);
    }

    const supabase = createClient();

    const projectResult = await supabase
      .from('projects')
      .select('id')
      .eq('organization_id', data.organization_id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(1);

    if (projectResult.error) return fail(projectResult.error.message, errorHandler);

    const project = projectResult.data[0];
    if (!project) return fail('该组织暂无可用项目，无法创建文档', errorHandler);

    const insertResult = await supabase
      .from('documents')
      .insert({
        organization_id: data.organization_id,
        project_id: project.id,
        title: data.title,
      })
      .select('id, title, created_at, updated_at')
      .single();

    if (insertResult.error) {
      return fail(writeErrorMessage(insertResult.error), errorHandler);
    }

    return ok<DocumentResponse>({
      id: insertResult.data.id,
      title: insertResult.data.title,
      type: 'FILE',
      created_at: insertResult.data.created_at,
      updated_at: insertResult.data.updated_at,
    });
  },

  /** Stub — awaiting share-links milestone (no share tables yet). */
  CreateShareLink: (
    _documentId: number | string,
    _data: CreateShareLinkDto,
    errorHandler?: ErrorHandler,
  ): Promise<RequestResult<ShareLinkResponse>> =>
    Promise.resolve(fail('分享链接功能暂未开放（等待 share-links 数据模型）', errorHandler)),

  /**
   * Soft delete (sets deleted_at). RLS makes this owner/admin-only by design:
   * the editor UPDATE policy pins deleted_at to null, so an editor's attempt
   * errors and a viewer's matches zero rows — both surface as a failure
   * envelope. `permanent` is ignored: clients hold no DELETE grant; hard
   * deletion is the server-side purge job.
   */
  DeleteDocument: async (
    data: DeleteDocumentDto,
    errorHandler?: ErrorHandler,
  ): Promise<RequestResult<{ success: boolean }>> => {
    const supabase = createClient();

    const result = await supabase
      .from('documents')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', data.document_id)
      .is('deleted_at', null)
      .select('id');

    if (result.error) return fail(result.error.message, errorHandler);

    if (!result.data || result.data.length === 0) {
      return fail('文档不存在或没有删除权限', errorHandler, 404);
    }

    return ok({ success: true }, '删除成功');
  },

  /** Rename = RLS-scoped title update (editor and above). */
  RenameDocument: async (
    data: RenameDocumentDto,
    errorHandler?: ErrorHandler,
  ): Promise<RequestResult<DocumentResponse>> => {
    const supabase = createClient();

    const result = await supabase
      .from('documents')
      .update({ title: data.title })
      .eq('id', data.document_id)
      .is('deleted_at', null)
      .select('id, title, created_at, updated_at')
      .single();

    if (result.error) return fail(writeErrorMessage(result.error), errorHandler);

    return ok<DocumentResponse>({
      id: result.data.id,
      title: result.data.title,
      type: 'FILE',
      created_at: result.data.created_at,
      updated_at: result.data.updated_at,
    });
  },

  /**
   * Stub — document content is authored through Yjs/Hocuspocus and versioned
   * via the create_document_version RPC; there is no content column here and
   * this method has zero live consumers.
   */
  SaveDocumentContent: (
    _documentId: number | string,
    _content: JSONContent,
    errorHandler?: ErrorHandler,
  ): Promise<RequestResult<{ success: boolean }>> =>
    Promise.resolve(fail('文档内容通过协同编辑保存，此接口已停用', errorHandler)),

  /**
   * Duplicate = RLS-scoped select + insert of the metadata row. Collaborative
   * content is NOT copied (it lives in Yjs/document_versions — awaiting a
   * server-side copy path). Returns 201 to match the legacy contract that
   * useFileOperations.handleDuplicate checks.
   */
  DuplicateDocument: async (
    data: DuplicateDocumentDto,
    errorHandler?: ErrorHandler,
  ): Promise<RequestResult<DocumentResponse>> => {
    const supabase = createClient();

    const source = await supabase
      .from('documents')
      .select('title, organization_id, project_id')
      .eq('id', data.document_id)
      .is('deleted_at', null)
      .maybeSingle();

    if (source.error) return fail(source.error.message, errorHandler);
    if (!source.data) return fail('文档不存在或没有权限', errorHandler, 404);

    const insertResult = await supabase
      .from('documents')
      .insert({
        organization_id: source.data.organization_id,
        project_id: source.data.project_id,
        title: data.title ?? `${source.data.title} - 副本`,
      })
      .select('id, title, created_at, updated_at')
      .single();

    if (insertResult.error) {
      return fail(writeErrorMessage(insertResult.error), errorHandler);
    }

    return ok<DocumentResponse>(
      {
        id: insertResult.data.id,
        title: insertResult.data.title,
        type: 'FILE',
        created_at: insertResult.data.created_at,
        updated_at: insertResult.data.updated_at,
      },
      '复制成功',
      201,
    );
  },

  /** Stub — awaiting an export/download milestone (no export endpoint yet). */
  DownloadDocument: (
    _documentId: string,
    errorHandler?: ErrorHandler,
  ): Promise<RequestResult<Blob>> =>
    Promise.resolve(fail('文档下载暂未开放（等待导出功能）', errorHandler)),

  /** Stub — awaiting share-links milestone; dead-code consumer only. */
  GetSharedDocuments: (
    _errorHandler?: ErrorHandler,
  ): Promise<RequestResult<SharedDocumentItem[]>> => Promise.resolve(ok<SharedDocumentItem[]>([])),

  /** Stub — awaiting share-links milestone (no share tables yet). */
  AccessSharedDocument: (
    _data: AccessSharedDocumentDto,
    errorHandler?: ErrorHandler,
  ): Promise<RequestResult<AccessSharedDocumentResponse>> =>
    Promise.resolve(fail('分享访问暂未开放（等待 share-links 数据模型）', errorHandler)),

  /**
   * Stub — awaiting folder-tree milestone (documents has no parent_id).
   * Returns an error envelope; dragDropStore refreshes the list afterwards,
   * which snaps the optimistic UI back to server state.
   */
  MoveDocuments: (
    _data: { document_ids: string[]; target_folder_id: string | null },
    errorHandler?: ErrorHandler,
  ): Promise<RequestResult<{ success: boolean }>> =>
    Promise.resolve(fail('移动文档暂未开放（等待目录树数据模型）', errorHandler)),

  /** Stub — awaiting recents (last_viewed) milestone; zero live consumers. */
  GetLatestDocuments: (
    _limit: number,
    _errorHandler?: ErrorHandler,
  ): Promise<RequestResult<LatestDocumentItem[]>> =>
    Promise.resolve(ok<LatestDocumentItem[]>([])),
};

export default DocumentApi;
