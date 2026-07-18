import { NextRequest, NextResponse } from 'next/server';

import { updateSession } from '@/lib/supabase/middleware';
import { ROUTES } from '@/utils/constants/routes';

// ============================================================================
// Constants
// ============================================================================

/**
 * Cookies written by the pre-Supabase hand-rolled auth flow. Cleared on auth
 * redirects as one-release hygiene; safe to remove after that.
 */
const LEGACY_AUTH_COOKIES = [
  'auth_token',
  'refresh_token',
  'expires_in',
  'refresh_expires_in',
  'auth_timestamp',
] as const;

/**
 * Public routes that never require authentication.
 * Proxy will always allow access to these paths.
 */
const PUBLIC_ROUTES = new Set([ROUTES.AUTH, '/auth/callback', '/', '/blog', '/share']);

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a pathname is a public route (no auth required).
 * Handles exact matches and prefix matches (e.g. /blog/123, /share/abc).
 */
function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_ROUTES.has(pathname)) return true;

  return (
    pathname.startsWith('/blog/') || pathname.startsWith('/share/') || pathname.startsWith('/auth/')
  );
}

/**
 * Redirect to the auth page.
 * Only sets redirect_to for protected routes — never for public routes,
 * which would otherwise cause an infinite redirect loop.
 *
 * Copies every Set-Cookie from the session-refresh response so refreshed or
 * cleared Supabase cookies still reach the client, and drops the legacy
 * hand-rolled auth cookies.
 */
function buildAuthRedirect(request: NextRequest, sessionResponse: NextResponse): NextResponse {
  const { pathname, search } = request.nextUrl;
  const authUrl = new URL(ROUTES.AUTH, request.url);

  if (!isPublicRoute(pathname)) {
    // Let URLSearchParams handle encoding — avoid double-encoding (%252F)
    authUrl.searchParams.set('redirect_to', pathname + search);
  }

  const response = NextResponse.redirect(authUrl);

  sessionResponse.cookies.getAll().forEach((cookie) => {
    response.cookies.set(cookie);
  });

  LEGACY_AUTH_COOKIES.forEach((name) => response.cookies.delete(name));

  return response;
}

// ============================================================================
// Proxy (Next.js 16+)
// ============================================================================

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Always allow public routes through — no session check needed.
  // Note: widening the matcher later so public pages also refresh sessions is
  // an option, but is not needed for M1.
  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  const { user, response } = await updateSession(request);

  if (!user) {
    return buildAuthRedirect(request, response);
  }

  return response;
}

// ============================================================================
// Proxy Configuration
// ============================================================================

export const config = {
  matcher: [
    /*
     * Only run on protected routes. Public routes excluded:
     * - Homepage: /
     * - Auth: /auth, /auth/callback
     * - Public content: /blog/*, /share/*
     * - Next.js internals: /_next/*, /api/*
     */
    '/docs/:path*',
    '/dashboard/:path*',
    '/chat-ai/:path*',
    '/rooms/:path*',
  ],
};
