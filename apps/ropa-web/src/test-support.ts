import { commands } from 'vitest/browser';

declare module 'vitest/browser' {
  interface BrowserCommands {
    setColorScheme: (scheme: 'light' | 'dark') => Promise<void>;
  }
}

/** Emulates the OS's colour-scheme preference. */
export function setColorScheme(scheme: 'light' | 'dark'): Promise<void> {
  return commands.setColorScheme(scheme);
}
