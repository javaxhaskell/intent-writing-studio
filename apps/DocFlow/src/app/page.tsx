import Link from 'next/link';

/**
 * English landing page for the demo submission. The inherited DocFlow
 * marketing homepage (Chinese) lives in ./_components/homepage and is
 * intentionally not rendered; it will be replaced wholesale in the
 * localization milestone.
 */
export default function Page() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white px-6 text-neutral-900">
      <div className="w-full max-w-2xl">
        <p className="mb-4 text-sm font-medium uppercase tracking-widest text-violet-600">
          Intent Writing Studio
        </p>
        <h1 className="mb-6 text-4xl font-bold leading-tight sm:text-5xl">
          Steer the decisions,
          <br />
          not just the words.
        </h1>
        <p className="mb-4 text-lg leading-relaxed text-neutral-600">
          The studio proposes 3–5 genuinely different ways to write your piece, turns your chosen
          strategy into an editable intent graph, and links every paragraph of the draft to the
          intention that produced it.
        </p>
        <p className="mb-10 text-lg leading-relaxed text-neutral-600">
          Change an intention and you see exactly which blocks are affected before anything is
          rewritten — then only those blocks regenerate, as diffs you accept or reject.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <Link
            href="/studio"
            className="rounded-lg bg-neutral-900 px-6 py-3 font-semibold text-white transition-colors hover:bg-neutral-700"
          >
            Open the Studio
          </Link>
          <Link
            href="/auth"
            className="rounded-lg border border-neutral-300 px-6 py-3 font-semibold text-neutral-800 transition-colors hover:bg-neutral-50"
          >
            Sign in / Try the demo
          </Link>
        </div>
        <p className="mt-10 text-sm text-neutral-400">
          One frozen model per project. No hidden chain-of-thought — every explanation comes from
          explicit, editable intent.
        </p>
      </div>
    </main>
  );
}
