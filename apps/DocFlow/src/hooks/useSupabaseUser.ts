'use client';

import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/client';

export interface SupabaseUserState {
  /** The signed-in Supabase user, or null when signed out. */
  user: User | null;
  /** True until the initial getUser() round-trip resolves. */
  isLoading: boolean;
}

/**
 * Minimal client-side identity accessor for the Supabase session.
 *
 * Resolves the current user once via `getUser()` (server-validated), then
 * stays in sync through `onAuthStateChange` — including sign-ins/sign-outs
 * performed in other tabs.
 */
export function useSupabaseUser(): SupabaseUserState {
  const [state, setState] = useState<SupabaseUserState>({ user: null, isLoading: true });

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    supabase.auth.getUser().then(({ data }) => {
      if (active) {
        setState({ user: data.user ?? null, isLoading: false });
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) {
        setState({ user: session?.user ?? null, isLoading: false });
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return state;
}
