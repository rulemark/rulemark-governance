'use client';

import { Button } from '@rulemark/ui/components/button';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';

type Choice = 'system' | 'light' | 'dark';

const after: Record<Choice, Choice> = { system: 'light', light: 'dark', dark: 'system' };
const icons = { system: Monitor, light: Sun, dark: Moon };

// False while rendering on the server and hydrating, true after: the server
// can't know a stored choice, so both render "system" and agree.
const noop = () => () => {};
function useIsClient(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

/** Cycles the theme: the OS's, then light, then dark. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const isClient = useIsClient();

  const choice: Choice = isClient && (theme === 'light' || theme === 'dark') ? theme : 'system';
  const Icon = icons[choice];

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Theme: ${choice}`}
      title={`Theme: ${choice}. Switch to ${after[choice]}`}
      onClick={() => setTheme(after[choice])}
    >
      <Icon aria-hidden />
    </Button>
  );
}
