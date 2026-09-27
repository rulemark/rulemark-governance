import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';

import { Providers } from './providers';
import { SiteHeader } from './site-header';

describe('SiteHeader', () => {
  it('is the page banner', async () => {
    const screen = await render(
      <Providers>
        <SiteHeader />
      </Providers>,
    );

    await expect.element(screen.getByRole('banner')).toBeVisible();
  });

  it('links the Rulemark lockup home', async () => {
    const screen = await render(
      <Providers>
        <SiteHeader />
      </Providers>,
    );

    const home = screen.getByRole('link', { name: 'Rulemark, home' });
    await expect.element(home).toHaveAttribute('href', '/');
    await expect.element(home.getByRole('img', { name: 'Rulemark' })).toBeVisible();
  });

  it('offers the theme toggle', async () => {
    const screen = await render(
      <Providers>
        <SiteHeader />
      </Providers>,
    );

    await expect.element(screen.getByRole('button', { name: /^Theme:/ })).toBeVisible();
  });

  it('is the header height the foundations set', async () => {
    const screen = await render(
      <Providers>
        <SiteHeader />
      </Providers>,
    );

    expect(getComputedStyle(screen.getByRole('banner').element()).height).toBe('64px');
  });
});
