'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import type { ReactNode } from 'react';

import { getQueryClient } from '@/lib/query-client';

/**
 * What every page runs inside: TanStack Query's client, and next-themes,
 * which writes the resolved theme to `data-theme` on <html> (open question
 * 7). Before any script runs, the Rulemark theme already follows the OS.
 */
export function Providers({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();

  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}
