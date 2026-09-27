import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Tailwind compiles the theme for real, so a test can check the colour a
  // component is actually painted, in light and in dark.
  plugins: [react(), tailwindcss()],
  // Pre-bundled up front, so a dependency first seen mid-run (a new
  // component's Base UI import, against a cache from before it) can't make
  // Vite re-optimise and reload: with React split into two copies the symptom
  // is "Cannot read properties of null (reading 'useRef')" in every test. The
  // glob takes all of Base UI (about a hundred entries, a second cold).
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-dev-runtime',
      'vitest-browser-react',
      'class-variance-authority',
      'cn',
      'lucide-react',
      '@base-ui/react/**',
    ],
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
    restoreMocks: true,
    // Components run in a real Chromium: Base UI leans on focus, keyboard,
    // pointer events and portals, which jsdom only imitates.
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
  },
});
