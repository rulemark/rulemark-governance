import { useQueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';

import { setColorScheme } from '@/test-support';
import { Providers } from './providers';

function ClientProbe() {
  const client = useQueryClient();
  return <p>{client ? 'has a query client' : 'none'}</p>;
}

describe('Providers', () => {
  it('give the page a query client', async () => {
    const screen = await render(
      <Providers>
        <ClientProbe />
      </Providers>,
    );

    await expect.element(screen.getByText('has a query client')).toBeVisible();
  });

  // next-themes writes the resolved theme to data-theme, which is what the
  // Rulemark theme reads (open question 7).
  it("follow the OS's light preference, on <html>'s data-theme", async () => {
    await render(<Providers>page</Providers>);

    await expect.poll(() => document.documentElement.dataset.theme).toBe('light');
  });

  it("follow the OS's dark preference", async () => {
    await setColorScheme('dark');
    await render(<Providers>page</Providers>);

    await expect.poll(() => document.documentElement.dataset.theme).toBe('dark');
  });
});
