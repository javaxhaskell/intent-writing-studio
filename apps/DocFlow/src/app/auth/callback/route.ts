import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/server';

const DEFAULT_NEXT = '/studio';

/**
 * Allowlist for the post-login `next` redirect: same-origin relative paths
 * only ("/docs/abc?x=1"). Rejects absolute URLs, protocol-relative URLs
 * ("//evil.example") and backslash tricks ("/\evil.example") so the param can
 * never be used as an open redirect — unlike the legacy `state` param it
 * replaces.
 */
function sanitizeNextPath(raw: string | null): string {
  if (!raw) return DEFAULT_NEXT;

  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) {
    return DEFAULT_NEXT;
  }

  return raw;
}

/**
 * Supabase auth callback (ADR 0002: route handler).
 *
 * Handles both callback shapes Supabase Auth can send:
 * - PKCE flow (magic link / OAuth): `?code=...` -> exchangeCodeForSession
 * - Token-hash email templates: `?token_hash=...&type=email` -> verifyOtp
 *
 * On success the session cookies are written by the server client via
 * `cookies()` (route handlers may mutate cookies) and the user is redirected
 * to the sanitized `next` path.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = sanitizeNextPath(searchParams.get('next'));
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(new URL(next, request.url));
    }
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

    if (!error) {
      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  const authUrl = new URL('/auth', request.url);
  authUrl.searchParams.set('error', 'auth_callback_failed');

  return NextResponse.redirect(authUrl);
}
