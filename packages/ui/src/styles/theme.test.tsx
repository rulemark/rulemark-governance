import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import { colour, paint, setColorScheme, setDataTheme } from '../test-support';

// The brand's primary, as rulemark-colors.css v1 defines it: logo green in the
// light theme, logo lime in the dark.
const lightPrimary = '#4D7C0F';
const darkPrimary = '#A3E635';

describe('which theme applies', () => {
  it('is light by default', () => {
    expect(colour('--rm-primary')).toBe(colour(lightPrimary));
  });

  it("follows the OS's dark preference when <html> has no data-theme", async () => {
    await setColorScheme('dark');

    expect(colour('--rm-primary')).toBe(colour(darkPrimary));
  });

  it('is dark with data-theme="dark", whatever the OS prefers', () => {
    setDataTheme('dark');

    expect(colour('--rm-primary')).toBe(colour(darkPrimary));
  });

  it('is light with data-theme="light", even when the OS prefers dark', async () => {
    await setColorScheme('dark');
    setDataTheme('light');

    expect(colour('--rm-primary')).toBe(colour(lightPrimary));
  });
});

// shadcn's components name colours their own way; each name is defined from a
// Rulemark token (open question 8). Components read some of these directly,
// as `var(--primary)`, and the rest through Tailwind utilities.
const bridge: [shadcn: string, rulemark: string][] = [
  ['--background', '--rm-canvas'],
  ['--foreground', '--rm-fg'],
  ['--card', '--rm-surface'],
  ['--card-foreground', '--rm-fg'],
  ['--popover', '--rm-surface-raised'],
  ['--popover-foreground', '--rm-fg'],
  ['--primary', '--rm-primary'],
  ['--primary-foreground', '--rm-primary-fg'],
  ['--secondary', '--rm-neutral-subtle'],
  ['--secondary-foreground', '--rm-neutral-subtle-fg'],
  ['--muted', '--rm-surface-hover'],
  ['--muted-foreground', '--rm-fg-muted'],
  ['--accent', '--rm-surface-hover'],
  ['--accent-foreground', '--rm-fg'],
  ['--destructive', '--rm-danger'],
  ['--border', '--rm-border'],
  ['--input', '--rm-input-border'],
  ['--ring', '--rm-ring'],
  ['--sidebar', '--rm-nav'],
  ['--sidebar-foreground', '--rm-nav-fg'],
  ['--sidebar-primary', '--rm-primary'],
  ['--sidebar-primary-foreground', '--rm-primary-fg'],
  ['--sidebar-accent', '--rm-nav-hover'],
  ['--sidebar-accent-foreground', '--rm-nav-active-fg'],
  ['--sidebar-border', '--rm-nav-border'],
  ['--sidebar-ring', '--rm-ring'],
];

// The utilities, written out in full so Tailwind generates them. The ones
// that matter most are where the two vocabularies clash: `input` and
// `secondary` keep shadcn's meaning, and Rulemark's field background is
// `field`.
const utilities: [className: string, rulemark: string][] = [
  ['bg-background', '--rm-canvas'],
  ['bg-card', '--rm-surface'],
  ['bg-popover', '--rm-surface-raised'],
  ['bg-muted', '--rm-surface-hover'],
  ['bg-accent', '--rm-surface-hover'],
  ['bg-destructive', '--rm-danger'],
  ['bg-primary', '--rm-primary'],
  ['bg-border', '--rm-border'],
  ['bg-ring', '--rm-ring'],
  ['bg-input', '--rm-input-border'],
  ['bg-secondary', '--rm-neutral-subtle'],
  ['bg-field', '--rm-input'],
  ['bg-sidebar', '--rm-nav'],
  // Rulemark's own names, for app code.
  ['bg-canvas', '--rm-canvas'],
  ['bg-surface', '--rm-surface'],
  ['bg-danger-subtle', '--rm-danger-subtle'],
  ['bg-success', '--rm-success'],
  ['bg-fg-muted', '--rm-fg-muted'],
];

describe.each(['light', 'dark'] as const)('the bridge, %s', (theme) => {
  it.each(bridge)('%s is %s', (shadcn, rulemark) => {
    setDataTheme(theme);

    expect(colour(shadcn)).toBe(colour(rulemark));
  });

  it.each(utilities)('.%s paints %s', async (className, rulemark) => {
    setDataTheme(theme);
    const screen = await render(<div data-testid="swatch" className={className} />);

    expect(paint(screen.getByTestId('swatch').element(), 'backgroundColor')).toBe(colour(rulemark));
  });
});

describe('the base styles', () => {
  it.each(['light', 'dark'] as const)('paint the page canvas, %s', (theme) => {
    setDataTheme(theme);

    expect(paint(document.body, 'backgroundColor')).toBe(colour('--rm-canvas'));
    expect(paint(document.body, 'color')).toBe(colour('--rm-fg'));
  });

  it("outline a focused link in the ring colour, as Rulemark's focus style", async () => {
    const screen = await render(<a href="#somewhere">Somewhere</a>);

    await userEvent.tab();
    const link = screen.getByRole('link', { name: 'Somewhere' }).element();
    await expect.element(screen.getByRole('link')).toHaveFocus();

    const style = getComputedStyle(link);
    expect(style.outlineStyle).toBe('solid');
    expect(style.outlineWidth).toBe('2px');
    expect(style.outlineColor).toBe(colour('--rm-ring'));
  });
});
