import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';

// The foundations (rulemark-foundations.css v1): Geist, the type scale, the
// spacing and layout tokens, and the radii, as the browser computes them.

afterEach(() => {
  document.documentElement.style.removeProperty('--font-geist-sans');
  document.documentElement.style.removeProperty('--font-geist-mono');
});

/** The first family of an element's computed font stack. */
function firstFamily(element: Element): string {
  return getComputedStyle(element).fontFamily.split(',')[0]!.trim().replace(/"/g, '');
}

describe('the font stacks', () => {
  it('put Geist first', () => {
    expect(firstFamily(document.body)).toBe('Geist');
  });

  // next/font's `geist` sets these on <html> (open question 12).
  it("take the face next/font's geist package names", () => {
    document.documentElement.style.setProperty('--font-geist-sans', '"Loaded Sans"');

    expect(firstFamily(document.body)).toBe('Loaded Sans');
  });

  it('give code Geist Mono', async () => {
    const screen = await render(<code>CC6.1</code>);
    const code = screen.getByText('CC6.1').element();

    expect(firstFamily(code)).toBe('Geist Mono');
    document.documentElement.style.setProperty('--font-geist-mono', '"Loaded Mono"');
    expect(firstFamily(code)).toBe('Loaded Mono');
  });
});

// Each step of the type scale sets size, line height, tracking and weight
// together. The class names are written out so Tailwind generates them.
const typeScale: [className: string, token: string][] = [
  ['text-display', '--text-display'],
  ['text-h1', '--text-h1'],
  ['text-h2', '--text-h2'],
  ['text-h3', '--text-h3'],
  ['text-h4', '--text-h4'],
  ['text-body-lg', '--text-body-lg'],
  ['text-body', '--text-body'],
  ['text-body-sm', '--text-body-sm'],
  ['text-label', '--text-label'],
  ['text-label-sm', '--text-label-sm'],
  ['text-caption', '--text-caption'],
  ['text-overline', '--text-overline'],
  ['text-code', '--text-code'],
];

/** Size, line height, tracking and weight, as an element with a token's values computes them. */
function typeOf(token: string) {
  // As with colours, an undefined token would compare equal to another.
  for (const name of [token, `${token}--line-height`, `${token}--font-weight`]) {
    const defined = getComputedStyle(document.documentElement).getPropertyValue(name);
    if (defined.trim() === '') throw new Error(`${name} is not defined`);
  }
  const probe = document.createElement('p');
  probe.style.fontSize = `var(${token})`;
  probe.style.lineHeight = `var(${token}--line-height)`;
  probe.style.letterSpacing = `var(${token}--letter-spacing)`;
  probe.style.fontWeight = `var(${token}--font-weight)`;
  document.body.append(probe);
  const type = setOf(probe);
  probe.remove();
  return type;
}

function setOf(element: Element) {
  const { fontSize, lineHeight, letterSpacing, fontWeight } = getComputedStyle(element);
  return { fontSize, lineHeight, letterSpacing, fontWeight };
}

describe('the type scale', () => {
  it.each(typeScale)('.%s sets all four of %s', async (className, token) => {
    const screen = await render(<p className={className}>Text</p>);

    expect(setOf(screen.getByText('Text').element())).toEqual(typeOf(token));
  });

  // Anchors, so the comparison above can't pass on two empty values.
  it('makes body text 14/22 and h1 28/36 semibold', () => {
    expect(typeOf('--text-body')).toMatchObject({ fontSize: '14px', lineHeight: '22px' });
    expect(typeOf('--text-h1')).toMatchObject({
      fontSize: '28px',
      lineHeight: '36px',
      fontWeight: '600',
    });
  });
});

describe('the base styles', () => {
  it('set the page in body text', () => {
    expect(setOf(document.body)).toMatchObject({ fontSize: '14px', lineHeight: '22px' });
  });

  it.each(['h1', 'h2', 'h3', 'h4'] as const)('give a plain <%s> its step', async (Heading) => {
    const screen = await render(<Heading>Title</Heading>);

    expect(setOf(screen.getByText('Title').element())).toEqual(typeOf(`--text-${Heading}`));
  });

  it('let a utility override a heading default', async () => {
    const screen = await render(<h1 className="text-body">Title</h1>);

    expect(setOf(screen.getByText('Title').element())).toMatchObject({ fontSize: '14px' });
  });

  it('line up numbers in tables', async () => {
    const screen = await render(
      <table>
        <tbody>
          <tr>
            <td>1,175</td>
          </tr>
        </tbody>
      </table>,
    );

    expect(getComputedStyle(screen.getByRole('table').element()).fontVariantNumeric).toBe(
      'tabular-nums',
    );
  });
});

// Named layout tokens; Tailwind's 4px grid is unchanged.
const lengths: [
  className: string,
  property: 'height' | 'paddingLeft' | 'maxWidth' | 'width',
  px: string,
][] = [
  ['h-control-sm', 'height', '32px'],
  ['h-control', 'height', '36px'],
  ['h-control-lg', 'height', '44px'],
  ['px-control-x', 'paddingLeft', '14px'],
  ['p-card', 'paddingLeft', '20px'],
  ['px-gutter', 'paddingLeft', '28px'],
  ['h-row', 'height', '44px'],
  ['h-row-compact', 'height', '36px'],
  ['w-sidebar', 'width', '240px'],
  ['max-w-form', 'maxWidth', '576px'],
  ['max-w-page', 'maxWidth', '1280px'],
  ['h-4', 'height', '16px'],
];

describe('spacing', () => {
  it.each(lengths)('.%s is a %s of %s', async (className, property, px) => {
    const screen = await render(<div data-testid="box" className={className} />);

    expect(getComputedStyle(screen.getByTestId('box').element())[property]).toBe(px);
  });
});

// shadcn's steps carry the spec's values (open question 10), beside the
// spec's own names.
const radii: [className: string, px: string][] = [
  ['rounded-sm', '4px'],
  ['rounded-md', '6px'],
  ['rounded-lg', '8px'],
  ['rounded-xl', '12px'],
  ['rounded-2xl', '16px'],
  ['rounded-xs', '4px'],
  ['rounded-badge', '6px'],
  ['rounded-control', '8px'],
  ['rounded-popover', '10px'],
  ['rounded-card', '12px'],
  ['rounded-dialog', '16px'],
  ['rounded-pill', '9999px'],
];

describe('radius', () => {
  it.each(radii)('.%s is %s', async (className, px) => {
    const screen = await render(<div data-testid="box" className={className} />);

    expect(getComputedStyle(screen.getByTestId('box').element()).borderTopLeftRadius).toBe(px);
  });

  // shadcn's pill badges are rounded-4xl on a 20px-tall badge.
  it('keeps rounded-4xl round on a badge', async () => {
    const screen = await render(<div data-testid="box" className="h-5 rounded-4xl" />);
    const radius = parseFloat(
      getComputedStyle(screen.getByTestId('box').element()).borderTopLeftRadius,
    );

    expect(radius).toBeGreaterThanOrEqual(10);
  });
});
