// NOTE: no imports from components/ui here — this is a server component and the
// ui primitives pull in the client-only `@/utils` barrel (createContext) which
// crashes RSC compilation. Plain elements + Tailwind instead.
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const ERROR_MESSAGES: Record<string, string> = {
  'no-organization':
    'You are not a member of any organization yet, so a demo document cannot be created.',
  'no-project': 'Your organization has no project yet, so a demo document cannot be created.',
  'create-failed': 'Creating the demo document failed. Please try again.',
};

async function createDemoDocument() {
  'use server';

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/auth');

  const { data: membership } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership) redirect('/studio?error=no-organization');

  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('organization_id', membership.organization_id)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!project) redirect('/studio?error=no-project');

  const { data: doc, error } = await supabase
    .from('documents')
    .insert({
      organization_id: membership.organization_id,
      project_id: project.id,
      title: 'Untitled brief',
    })
    .select('id')
    .single();

  if (error || !doc) redirect('/studio?error=create-failed');

  redirect(`/studio/${doc.id}`);
}

export default async function StudioIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/auth');

  const { data: documents } = await supabase
    .from('documents')
    .select('id,title,created_at,updated_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  const errorMessage = error ? ERROR_MESSAGES[error] : null;

  return (
    // The root layout pins body/main to h-full with no page scroll, so studio
    // pages own their scroll container.
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Intent Writing Studio</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Explore writing pathways, inspect the intent behind every block, and regenerate only
              what your changes affect.
            </p>
          </div>
          <form action={createDemoDocument}>
            <button
              type="submit"
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs transition-all hover:bg-primary/90"
            >
              New demo document
            </button>
          </form>
        </div>

        {errorMessage ? (
          <div className="mb-6 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {errorMessage}
          </div>
        ) : null}

        {!documents || documents.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            No documents yet. Create a demo document to start.
          </div>
        ) : (
          <ul className="divide-y rounded-lg border">
            {documents.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{doc.title || 'Untitled'}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Created {new Date(doc.created_at).toLocaleString()}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="hidden rounded-md border border-transparent bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground sm:inline-flex">
                    Demo
                  </span>
                  <Link
                    href={`/studio/${doc.id}`}
                    className="inline-flex h-8 items-center justify-center rounded-md border bg-background px-3 text-sm font-medium shadow-xs transition-all hover:bg-accent hover:text-accent-foreground"
                  >
                    Open in Studio
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
