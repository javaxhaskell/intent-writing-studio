import { notFound, redirect } from 'next/navigation';

import { StudioClient } from './_components/StudioClient';

import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function StudioDocumentPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { documentId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/auth');

  const { data: document } = await supabase
    .from('documents')
    .select('id,title')
    .eq('id', documentId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!document) notFound();

  return <StudioClient documentId={document.id} documentTitle={document.title || 'Untitled'} />;
}
