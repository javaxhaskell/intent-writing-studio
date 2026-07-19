import { GatewayError } from '@/lib/studio/gateway';
import { createClient } from '@/lib/supabase/server';

/** JSON error response helper. */
export function jsonError(status: number, error: string, details?: unknown) {
  return Response.json(details === undefined ? { error } : { error, details }, { status });
}

/** Auth gate — theem routes are stateless but must not be an open model proxy. */
export async function requireUser(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id ?? null;
}

/** Maps thrown gateway errors to responses without leaking internals. */
export function handleTheemError(err: unknown) {
  if (err instanceof GatewayError) {
    console.error(`[theem] gateway error (${err.kind}):`, err.message);

    if (err.kind === 'config') {
      return jsonError(500, 'Model provider is not configured on the server');
    }

    return jsonError(502, 'The model could not complete this step — please try again');
  }

  console.error('[theem] unexpected route error:', err);

  return jsonError(500, 'Internal server error');
}

export function briefBlock(brief: {
  coreMessage: string;
  audience: string;
  desiredEffect: string;
  mustInclude?: string;
  mustAvoid?: string;
}): string {
  return [
    `Core message: ${brief.coreMessage}`,
    `Audience: ${brief.audience}`,
    `Desired effect: ${brief.desiredEffect}`,
    brief.mustInclude ? `Must include: ${brief.mustInclude}` : '',
    brief.mustAvoid ? `Must avoid: ${brief.mustAvoid}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
