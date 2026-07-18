import { useState, useEffect } from 'react';
import * as Y from 'yjs';

import { getDocumentAccess } from '@/services/document/access';
import { DocumentPermissionData } from '@/services/document/type';
import { getCursorColorByUserId } from '@/utils';

export interface CollaborationUser {
  id: string;
  name: string;
  color: string;
  avatar: string;
}

export interface UseDocumentPermissionResult {
  permissionData: DocumentPermissionData | null;
  isLoadingPermission: boolean;
  permissionError: string | null;
  isMounted: boolean;
  doc: Y.Doc | null;
  currentUser: CollaborationUser | null;
}

export function useDocumentPermission(documentId: string): UseDocumentPermissionResult {
  const [permissionData, setPermissionData] = useState<DocumentPermissionData | null>(null);
  const [isLoadingPermission, setIsLoadingPermission] = useState(true);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [doc, setDoc] = useState<Y.Doc | null>(null);
  const [currentUser, setCurrentUser] = useState<CollaborationUser | null>(null);

  useEffect(() => {
    if (!documentId || typeof window === 'undefined') return;

    async function init() {
      setIsLoadingPermission(true);
      setPermissionError(null);

      // Supabase RPC bootstrap (public.get_document_access) — replaces the
      // legacy HTTP permission endpoint. The room param is the document uuid,
      // so no numeric coercion happens anymore. serverReadOnly from the
      // Hocuspocus `server:permission` message stays authoritative at runtime.
      const { data: permData, error } = await getDocumentAccess(documentId);

      if (error) {
        setPermissionError(error);
        setIsLoadingPermission(false);

        return;
      }

      if (!permData) {
        setPermissionError('无法获取文档权限信息');
        setIsLoadingPermission(false);

        return;
      }

      setPermissionData(permData);
      setIsLoadingPermission(false);

      if (permData.permission === 'NONE') {
        setIsMounted(true);

        return;
      }

      setDoc(new Y.Doc());
      setCurrentUser({
        id: permData.userId.toString(),
        name: permData.username,
        color: getCursorColorByUserId(permData.userId.toString()),
        avatar: permData.avatar,
      });
      setIsMounted(true);
    }

    init();
  }, [documentId]);

  return { permissionData, isLoadingPermission, permissionError, isMounted, doc, currentUser };
}
