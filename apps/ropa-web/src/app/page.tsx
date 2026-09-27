import type { Metadata } from 'next';

// The layout's title template applies to pages below it, not beside it.
export const metadata: Metadata = { title: { absolute: 'Processing activities · Rulemark' } };

// The record's activities arrive in Phase 3, read through the proxy.
export default function HomePage() {
  return (
    <>
      <h1>Processing activities</h1>
      <p className="mt-2 text-fg-muted">The record&rsquo;s activities will be listed here.</p>
    </>
  );
}
