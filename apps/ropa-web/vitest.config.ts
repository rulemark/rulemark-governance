import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { playwright } from '@vitest/browser-playwright';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import type { BrowserCommand } from 'vitest/node';

// The OS's light or dark preference, which the theme follows by default.
const setColorScheme: BrowserCommand<[scheme: 'light' | 'dark']> = async ({ page }, scheme) => {
  await page.emulateMedia({ colorScheme: scheme });
};

const shared = {
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    // Workspace packages resolve to their TypeScript sources.
    conditions: ['development'],
  },
};

export default defineConfig({
  test: {
    restoreMocks: true,
    projects: [
      {
        ...shared,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          restoreMocks: true,
        },
      },
      {
        ...shared,
        plugins: [react(), tailwindcss()],
        // Next's own modules (next/link) read process.env, which Next defines
        // in its bundles and a plain browser doesn't have.
        define: { 'process.env': '{}' },
        // As in @rulemark/ui: pre-bundled up front, so a dependency first seen
        // mid-run can't make Vite reload and split React into two copies.
        optimizeDeps: {
          include: [
            'react',
            'react-dom',
            'react-dom/client',
            'react/jsx-dev-runtime',
            'vitest-browser-react',
            'class-variance-authority',
            'cn',
            'cn/config',
            'lucide-react',
            'next-themes',
            '@tanstack/react-query',
            '@base-ui/react/**',
          ],
        },
        test: {
          name: 'browser',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['./src/test-setup.ts'],
          restoreMocks: true,
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
            commands: { setColorScheme },
          },
        },
      },
    ],
  },
});
