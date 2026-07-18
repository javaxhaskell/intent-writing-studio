import { createBrowserClient } from '@supabase/ssr';

import type { Database } from '@/types/database';

/**
 * Browser-side Supabase client.
 *
 * `createBrowserClient` returns a per-page singleton under the hood, so calling
 * this from multiple components is cheap and always yields the same instance.
 *
 * Auth state lives in cookies managed by @supabase/ssr, which lets the proxy
 * and route handlers read the same session. Never reference
 * SUPABASE_SERVICE_ROLE_KEY here — this file ships in the client bundle.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // @supabase/ssr defaults omit the Secure attribute. Force it in
      // production so auth cookies (incl. the refresh token) never travel
      // over plaintext http; left off in dev for the http://127.0.0.1 stack.
      cookieOptions: {
        secure: process.env.NODE_ENV === 'production',
      },
    },
  );
}
