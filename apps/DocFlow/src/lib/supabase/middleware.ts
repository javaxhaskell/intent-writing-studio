import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { User } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

export interface SupabaseSessionResult {
  /** Server-validated user, or null when there is no (valid) session. */
  user: User | null;
  /**
   * Response carrying any refreshed Supabase auth cookies. Callers MUST
   * either return this response or copy its cookies onto the response they
   * return, otherwise refreshed sessions are silently dropped.
   */
  response: NextResponse;
}

/**
 * Refresh the Supabase auth session inside the proxy (Next.js middleware).
 *
 * Edge-safe: only imports @supabase/ssr and next/server (the supabase-js
 * import above is type-only and erased at compile time).
 */
export async function updateSession(request: NextRequest): Promise<SupabaseSessionResult> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // @supabase/ssr defaults omit the Secure attribute. Force it in
      // production so auth cookies (incl. the refresh token) never travel
      // over plaintext http; left off in dev for the http://127.0.0.1 stack.
      cookieOptions: {
        secure: process.env.NODE_ENV === 'production',
      },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() validates the JWT against Supabase Auth on every call. Never
  // use getSession() here — its payload comes straight from client-writable
  // cookies and must not be trusted for access control.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { user, response };
}
