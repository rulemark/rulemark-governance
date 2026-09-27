import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';

import { setColorScheme } from '@/test-support';
import { Providers } from './providers';
import { ThemeToggle } from './theme-toggle';

async function renderToggle() {
  const screen = await render(
    <Providers>
      <ThemeToggle />
    </Providers>,
  );
  return { screen, toggle: screen.getByRole('button', { name: /^Theme:/ }) };
}

const theme = () => document.documentElement.dataset.theme;

describe('ThemeToggle', () => {
  it('starts at the system theme, and says so', async () => {
    const { toggle } = await renderToggle();

    await expect.element(toggle).toHaveAccessibleName('Theme: system');
  });

  it('cycles system → light → dark → system', async () => {
    await setColorScheme('dark');
    const { toggle } = await renderToggle();
    await expect.poll(theme).toBe('dark');

    await toggle.click();
    await expect.element(toggle).toHaveAccessibleName('Theme: light');
    await expect.poll(theme).toBe('light');

    await toggle.click();
    await expect.element(toggle).toHaveAccessibleName('Theme: dark');
    await expect.poll(theme).toBe('dark');

    await toggle.click();
    await expect.element(toggle).toHaveAccessibleName('Theme: system');
    await expect.poll(theme).toBe('dark');
  });

  it('remembers the choice for the next visit', async () => {
    const { toggle } = await renderToggle();

    await toggle.click();

    await expect.poll(() => localStorage.getItem('theme')).toBe('light');
  });
});
