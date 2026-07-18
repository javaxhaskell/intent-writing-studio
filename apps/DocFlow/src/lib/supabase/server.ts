import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import type { Database } from '@/types/database';

/**
 * Server-side Supabase client for Server Components, Server Actions, and
 * App Router route handlers.
 *
 * Always create a fresh client per request — never cache it in a module-level
 * variable, or one request could leak another request's session.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
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
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component render, which cannot write
            // cookies. Safe to ignore: the proxy (updateSession) persists
            // refreshed session cookies on the response instead.
          }
        },
      },
    },
  );
}
