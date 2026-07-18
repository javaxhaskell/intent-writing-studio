'use client';

import React, { useState } from 'react';
import { MailCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { z } from 'zod';

import { InputWrapper } from '@/components/ui/input-wrapper';
import { createClient } from '@/lib/supabase/client';

const emailSchema = z.string().email();

/**
 * Fixed, provider-agnostic failure copy. Echoing the raw Supabase error would
 * leak backend internals (rate-limit wording, signup-disabled state) that aid
 * automated probing — the real error goes to the console only, mirroring the
 * deliberately generic success state.
 */
const GENERIC_SEND_ERROR = 'Could not send the link right now — please try again in a moment';

const GENERIC_DEMO_ERROR = 'Demo sign-in is unavailable right now — please try again in a moment';

/**
 * Shared demo account (seeded by scripts/seed-demo-hosted.mjs). These are
 * deliberately public demo credentials, not secrets — the env vars only exist
 * so hosted deployments can rotate them without a code change.
 */
const DEMO_EMAIL = process.env.NEXT_PUBLIC_DEMO_EMAIL || 'demo@nullfellows.dev';
const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_PASSWORD || 'intent-demo-2026';

interface MagicLinkFormProps {
  /** Sanitized same-origin path the user lands on after clicking the link. */
  redirectTo: string;
}

export const MagicLinkForm = ({ redirectTo }: MagicLinkFormProps) => {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isDemoSigningIn, setIsDemoSigningIn] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const handleDemoSignIn = async () => {
    setIsDemoSigningIn(true);

    try {
      const supabase = createClient();

      const { error } = await supabase.auth.signInWithPassword({
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
      });

      if (error) {
        console.error('demo signInWithPassword failed:', error.message);
        toast.error(GENERIC_DEMO_ERROR);

        return;
      }

      // Same sanitized target the magic-link flow lands on (auth/page.tsx).
      router.push(redirectTo);
      router.refresh();
    } catch (error) {
      console.error('demo signInWithPassword threw:', error);
      toast.error(GENERIC_DEMO_ERROR);
    } finally {
      setIsDemoSigningIn(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const parsed = emailSchema.safeParse(email.trim());

    if (!parsed.success) {
      toast.error('Please enter a valid email address');

      return;
    }

    setIsSending(true);

    try {
      const supabase = createClient();
      const emailRedirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(
        redirectTo,
      )}`;

      const { error } = await supabase.auth.signInWithOtp({
        email: parsed.data,
        options: {
          emailRedirectTo,
          shouldCreateUser: true,
        },
      });

      if (error) {
        console.error('signInWithOtp failed:', error.message);
        toast.error(GENERIC_SEND_ERROR);

        return;
      }

      setSentTo(parsed.data);
    } catch (error) {
      console.error('signInWithOtp threw:', error);
      toast.error(GENERIC_SEND_ERROR);
    } finally {
      setIsSending(false);
    }
  };

  if (sentTo) {
    return (
      <div className="space-y-4 animate-fade-in" role="status" aria-live="polite">
        <div className="flex flex-col items-center text-center gap-3 rounded-xl border border-gray-200 bg-gray-50/50 px-6 py-8">
          <MailCheck className="w-10 h-10 text-violet-500" aria-hidden />
          <h2 className="text-lg font-bold text-gray-900">Check your inbox</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            We sent a sign-in link to <span className="font-semibold text-gray-900">{sentTo}</span>.
            Click it to finish signing in — you can close this tab.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setSentTo(null)}
          className="w-full text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors underline underline-offset-4"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3.5 md:space-y-4">
      <form className="space-y-3.5 md:space-y-4" onSubmit={handleSubmit}>
        <div className="animate-fade-in" style={{ animationDelay: '300ms' }}>
          <label className="block text-sm font-medium text-gray-900 mb-1.5" htmlFor="email">
            Email address
          </label>
          <InputWrapper>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full bg-transparent text-base px-3.5 py-3 rounded-xl focus:outline-none text-gray-900 placeholder:text-gray-500"
            />
          </InputWrapper>
        </div>

        <button
          type="submit"
          disabled={isSending}
          className="w-full rounded-xl bg-gray-900 py-3.5 font-bold text-base text-white hover:bg-gray-800 active:bg-gray-700 transition-all duration-300 shadow-lg hover:shadow-xl animate-fade-in transform hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:bg-gray-900 cursor-pointer"
          style={{ animationDelay: '500ms' }}
        >
          {isSending ? (
            <span className="flex items-center justify-center gap-2 font-semibold">
              <svg
                className="animate-spin h-5 w-5"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              <span>Sending link...</span>
            </span>
          ) : (
            'Send magic link'
          )}
        </button>
      </form>

      {/* Demo access: shared seeded account, no email round-trip needed */}
      <div
        className="relative flex items-center justify-center animate-fade-in"
        style={{ animationDelay: '600ms' }}
      >
        <span className="w-full border-t border-gray-200"></span>
        <span className="px-3 text-sm md:text-xs text-gray-500 bg-white absolute font-medium">
          or
        </span>
      </div>

      <button
        type="button"
        onClick={handleDemoSignIn}
        disabled={isDemoSigningIn || isSending}
        className="w-full rounded-xl border border-gray-300 bg-white py-3.5 font-bold text-base text-gray-900 hover:bg-gray-50 active:bg-gray-100 transition-all duration-300 shadow-sm hover:shadow-md animate-fade-in transform hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:bg-white cursor-pointer"
        style={{ animationDelay: '650ms' }}
      >
        {isDemoSigningIn ? 'Signing in to the demo...' : 'Try the demo instantly'}
      </button>
    </div>
  );
};
