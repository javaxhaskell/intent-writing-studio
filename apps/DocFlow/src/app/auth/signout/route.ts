import { NextResponse, type NextRequest } from 'next/server';

import { createClient } from '@/lib/supabase/server';

/**
 * Sign the current user out and return to the login page.
 *
 * POST-only on purpose: signout is a state-changing action and must not be
 * triggerable via a plain link or prefetch. 303 turns the follow-up request
 * into a GET.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    await supabase.auth.signOut();
  }

  return NextResponse.redirect(new URL('/auth', request.url), { status: 303 });
}
