'use client';

import React, { useEffect, Suspense, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';

import { redirectManager } from '@/utils/redirect-manager';
import { MagicLinkForm } from '@/app/auth/_components/magic-link-form';
import { AuthBackground } from '@/app/auth/_components/auth-background';

const DEFAULT_REDIRECT = '/dashboard';

/**
 * Defense in depth: the callback route re-sanitizes `next` server-side, but
 * never even ask for a non-relative redirect.
 */
function sanitizeRedirect(raw: string): string {
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) {
    return DEFAULT_REDIRECT;
  }

  return raw;
}

function LoginContent() {
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Persist redirect_to across the magic-link round-trip
  useEffect(() => {
    if (!mounted) return;

    const redirectUrl = redirectManager.get(searchParams);
    redirectManager.save(redirectUrl);
  }, [searchParams, mounted]);

  // Surface callback failures (expired/invalid link, wrong browser, ...)
  useEffect(() => {
    if (!mounted) return;

    if (searchParams?.get('error') === 'auth_callback_failed') {
      toast.error('That sign-in link is invalid or has expired', {
        description: 'Please request a new magic link below.',
      });
    }
  }, [searchParams, mounted]);

  const redirectTo = sanitizeRedirect(redirectManager.get(searchParams));

  return (
    <div className="min-h-screen flex flex-col md:flex-row font-sans bg-white">
      {/* Left: sign-in form */}
      <section className="flex-1 flex items-center justify-center px-4 py-8 sm:p-6 md:p-8 bg-white">
        <div className="w-full max-w-md">
          <div className="flex flex-col gap-5 md:gap-7">
            {/* Heading */}
            <div className="animate-fade-in" style={{ animationDelay: '100ms' }}>
              <h1 className="text-3xl sm:text-3xl md:text-4xl lg:text-5xl font-bold leading-tight tracking-tight mb-2 md:mb-2.5 text-gray-900">
                Welcome back
              </h1>
              <p className="text-gray-600 text-base leading-relaxed font-medium">
                Enter your email and we&apos;ll send you a magic link — no password needed.
              </p>
            </div>

            {/* Magic-link form */}
            <MagicLinkForm redirectTo={redirectTo} />

            {/* Divider */}
            <div
              className="relative flex items-center justify-center animate-fade-in"
              style={{ animationDelay: '700ms' }}
            >
              <span className="w-full border-t border-gray-200"></span>
              <span className="px-3 text-sm md:text-xs text-gray-500 bg-white absolute font-medium">
                More options
              </span>
            </div>

            {/* OAuth providers land in a later milestone */}
            <p
              className="text-center text-sm text-gray-500 animate-fade-in"
              style={{ animationDelay: '800ms' }}
            >
              Sign-in with OAuth providers (GitHub, Google) is coming soon.
            </p>
          </div>
        </div>
      </section>

      {/* Right: background + testimonials */}
      <AuthBackground />
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex flex-col md:flex-row font-sans bg-white">
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Sparkles className="w-12 h-12 animate-pulse mx-auto mb-4 text-violet-500" />
              <h1 className="text-3xl font-bold mb-3 text-gray-900 tracking-tight">Welcome back</h1>
              <p className="text-base text-gray-600 font-medium">Loading...</p>
            </div>
          </div>
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
