import '@rulemark/ui/globals.css';

import { cn } from '@rulemark/ui/lib/utils';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { Providers } from '@/components/providers';
import { SiteHeader } from '@/components/site-header';

export const metadata: Metadata = {
  title: { default: 'Rulemark', template: '%s · Rulemark' },
  description: 'The record of processing activities.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // Geist through next/font (open question 12): self-hosted, preloaded, and
    // named as the foundations' font stacks expect. next-themes sets
    // data-theme before hydration, hence suppressHydrationWarning.
    <html lang="en" suppressHydrationWarning className={cn(GeistSans.variable, GeistMono.variable)}>
      <body>
        <Providers>
          <SiteHeader />
          <main className="mx-auto max-w-page px-gutter py-section">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
