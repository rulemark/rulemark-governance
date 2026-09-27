import type { ComponentType, SVGProps } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';

import icon from '../brand/rulemark-icon.svg?raw';
import lockupOnDark from '../brand/rulemark-lockup-on-dark.svg?raw';
import lockup from '../brand/rulemark-lockup.svg?raw';
import wordmarkOnDark from '../brand/rulemark-wordmark-on-dark.svg?raw';
import wordmark from '../brand/rulemark-wordmark.svg?raw';
import { colour, setColorScheme, setDataTheme } from '../test-support';
import { Icon, Lockup, Wordmark } from './logo';

// What a logo draws: its view box, and each shape in order with its geometry
// and the colour it's filled.
interface Drawing {
  viewBox: string | null;
  shapes: { tag: string; geometry: Record<string, string | null>; fill: string }[];
}

const geometry = ['x', 'y', 'width', 'height', 'rx', 'transform', 'd'];

function drawing(svg: SVGSVGElement, fillOf: (shape: Element) => string): Drawing {
  return {
    viewBox: svg.getAttribute('viewBox'),
    shapes: [...svg.querySelectorAll('rect, path')].map((shape) => ({
      tag: shape.tagName.toLowerCase(),
      geometry: Object.fromEntries(geometry.map((name) => [name, shape.getAttribute(name)])),
      fill: fillOf(shape),
    })),
  };
}

// The brand's own file, the reference each component is drawn from.
function fromFile(source: string): Drawing {
  const svg = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement;
  return drawing(svg as unknown as SVGSVGElement, (shape) => colour(shape.getAttribute('fill')!));
}

// The component as the browser paints it under the current theme.
function fromPage(svg: Element): Drawing {
  return drawing(svg as SVGSVGElement, (shape) => getComputedStyle(shape).fill);
}

const logos: [
  name: string,
  Logo: ComponentType<SVGProps<SVGSVGElement>>,
  light: string,
  dark: string,
][] = [
  ['Lockup', Lockup, lockup, lockupOnDark],
  ['Wordmark', Wordmark, wordmark, wordmarkOnDark],
  ['Icon', Icon, icon, icon],
];

// Every way a theme is chosen (open question 7), and the file each should
// match. The logo switches through the theme's own `dark` variant, so it's
// right on first paint, with no script.
const themes: [how: string, choose: () => Promise<void>, expected: 'light' | 'dark'][] = [
  ['by default', async () => {}, 'light'],
  ['when the OS prefers dark', () => setColorScheme('dark'), 'dark'],
  ['with data-theme="dark"', async () => setDataTheme('dark'), 'dark'],
  [
    'with data-theme="light" when the OS prefers dark',
    async () => {
      await setColorScheme('dark');
      setDataTheme('light');
    },
    'light',
  ],
];

describe.each(logos)('%s', (_name, Logo, light, dark) => {
  it('is an image named "Rulemark"', async () => {
    const screen = await render(<Logo />);

    await expect.element(screen.getByRole('img', { name: 'Rulemark' })).toBeVisible();
  });

  it.each(themes)('draws the brand file %s', async (_how, choose, expected) => {
    await choose();
    const screen = await render(<Logo />);

    const svg = screen.getByRole('img', { name: 'Rulemark' }).element();
    expect(fromPage(svg)).toEqual(fromFile(expected === 'light' ? light : dark));
  });

  it('takes a className, for sizing', async () => {
    const screen = await render(<Logo className="h-12" />);

    await expect.element(screen.getByRole('img')).toHaveClass('h-12');
  });
});
