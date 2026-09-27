import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import { colour, paint, setDataTheme } from '../test-support';
import { Button } from './button';

describe('Button', () => {
  it('is a native button named by its content', async () => {
    const screen = await render(<Button>Save</Button>);

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.element().tagName).toBe('BUTTON');
  });

  // A button inside a form must not submit it unless it asks to.
  it('does not submit a form by default', async () => {
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
    const screen = await render(
      <form onSubmit={(event) => onSubmit(event.nativeEvent as SubmitEvent)}>
        <Button>Add a row</Button>
      </form>,
    );

    await screen.getByRole('button', { name: 'Add a row' }).click();

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls onClick when clicked', async () => {
    const onClick = vi.fn();
    const screen = await render(<Button onClick={onClick}>Save</Button>);

    await screen.getByRole('button', { name: 'Save' }).click();

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('is reached with Tab and pressed with Enter or Space', async () => {
    const onClick = vi.fn();
    const screen = await render(<Button onClick={onClick}>Save</Button>);

    await userEvent.tab();
    await expect.element(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');

    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('does nothing when disabled', async () => {
    const onClick = vi.fn();
    const screen = await render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Save' });
    await expect.element(button).toBeDisabled();
    await button.click({ force: true });

    expect(onClick).not.toHaveBeenCalled();
  });

  it('lets a className override a conflicting variant class', async () => {
    const screen = await render(<Button className="h-12">Save</Button>);

    const button = screen.getByRole('button', { name: 'Save' });
    await expect.element(button).toHaveClass('h-12');
    await expect.element(button).not.toHaveClass('h-control');
  });

  // The foundations' control sizes and label text (open question 11), and
  // their control radius (open question 10).
  describe('sized to the Rulemark spec', () => {
    const sizes: [
      size: 'xs' | 'sm' | 'default' | 'lg',
      height: string,
      paddingLeft: string,
      fontSize: string,
      lineHeight: string,
    ][] = [
      ['xs', '24px', '8px', '12px', '16px'],
      ['sm', '32px', '14px', '12px', '16px'],
      ['default', '36px', '14px', '14px', '20px'],
      ['lg', '44px', '14px', '14px', '20px'],
    ];

    it.each(sizes)(
      '%s: %s tall, %s side padding, %s/%s label text',
      async (size, height, paddingLeft, fontSize, lineHeight) => {
        const screen = await render(<Button size={size}>Save</Button>);
        const style = getComputedStyle(screen.getByRole('button').element());

        expect({
          height: style.height,
          paddingLeft: style.paddingLeft,
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          fontWeight: style.fontWeight,
        }).toEqual({ height, paddingLeft, fontSize, lineHeight, fontWeight: '500' });
      },
    );

    it.each([
      ['icon-sm', '32px'],
      ['icon', '36px'],
      ['icon-lg', '44px'],
      ['icon-xs', '24px'],
    ] as const)('%s: a %s square', async (size, side) => {
      const screen = await render(<Button size={size} aria-label="More" />);
      const style = getComputedStyle(screen.getByRole('button').element());

      expect([style.width, style.height]).toEqual([side, side]);
    });

    it('lines up with anything else built at h-control', async () => {
      const screen = await render(
        <div className="flex items-start">
          <div data-testid="field" className="h-control w-40" />
          <Button>Search</Button>
        </div>,
      );

      expect(screen.getByRole('button').element().getBoundingClientRect().height).toBe(
        screen.getByTestId('field').element().getBoundingClientRect().height,
      );
    });

    it('has the control radius', async () => {
      const screen = await render(<Button>Save</Button>);

      expect(getComputedStyle(screen.getByRole('button').element()).borderTopLeftRadius).toBe(
        '8px',
      );
    });
  });

  // Restyled to Rulemark's button states (open question 8): each variant's
  // resting and hovered colours are the spec's tokens, in both themes.
  describe.each(['light', 'dark'] as const)('painted to the Rulemark spec, %s', (theme) => {
    async function renderButton(element: ReactElement) {
      setDataTheme(theme);
      const screen = await render(element);
      const locator = screen.getByRole('button');
      return { locator, button: locator.element() };
    }

    it('the default: primary, darker on hover in light, lighter in dark', async () => {
      const { locator, button } = await renderButton(<Button>Save</Button>);

      expect(paint(button, 'backgroundColor')).toBe(colour('--rm-primary'));
      expect(paint(button, 'color')).toBe(colour('--rm-primary-fg'));

      await locator.hover();
      await expect.poll(() => paint(button, 'backgroundColor')).toBe(colour('--rm-primary-hover'));
    });

    it("outline: Rulemark's secondary button, bordered", async () => {
      const { locator, button } = await renderButton(<Button variant="outline">Cancel</Button>);

      expect(paint(button, 'backgroundColor')).toBe(colour('--rm-secondary'));
      expect(paint(button, 'borderTopColor')).toBe(colour('--rm-secondary-border'));
      expect(paint(button, 'color')).toBe(colour('--rm-secondary-fg'));

      await locator.hover();
      await expect
        .poll(() => paint(button, 'backgroundColor'))
        .toBe(colour('--rm-secondary-hover'));
    });

    it('ghost: nothing behind it until hovered', async () => {
      const { locator, button } = await renderButton(<Button variant="ghost">More</Button>);

      expect(paint(button, 'backgroundColor')).toBe(colour('transparent'));

      await locator.hover();
      await expect.poll(() => paint(button, 'backgroundColor')).toBe(colour('--rm-ghost-hover'));
    });

    it('destructive: danger-subtle at rest, solid danger on hover', async () => {
      const { locator, button } = await renderButton(<Button variant="destructive">Delete</Button>);

      expect(paint(button, 'backgroundColor')).toBe(colour('--rm-danger-subtle'));
      expect(paint(button, 'color')).toBe(colour('--rm-danger-subtle-fg'));

      await locator.hover();
      await expect.poll(() => paint(button, 'backgroundColor')).toBe(colour('--rm-danger'));
      await expect.poll(() => paint(button, 'color')).toBe(colour('--rm-danger-fg'));
    });

    it("link: Rulemark's link colours", async () => {
      const { locator, button } = await renderButton(<Button variant="link">Details</Button>);

      expect(paint(button, 'color')).toBe(colour('--rm-link'));

      await locator.hover();
      await expect.poll(() => paint(button, 'color')).toBe(colour('--rm-link-hover'));
    });

    it("disabled: Rulemark's disabled colours, not a faded primary", async () => {
      const { button } = await renderButton(<Button disabled>Save</Button>);

      expect(paint(button, 'backgroundColor')).toBe(colour('--rm-disabled'));
      expect(paint(button, 'color')).toBe(colour('--rm-disabled-fg'));
      expect(getComputedStyle(button).opacity).toBe('1');
    });

    it("focused: Rulemark's focus outline, in the ring colour", async () => {
      await renderButton(<Button>Save</Button>);

      await userEvent.tab();
      const button = document.activeElement as HTMLElement;
      expect(button.tagName).toBe('BUTTON');

      // The button's `transition-all` animates the outline in, so wait for it.
      const style = getComputedStyle(button);
      expect(style.outlineStyle).toBe('solid');
      await expect.poll(() => style.outlineWidth).toBe('2px');
      await expect.poll(() => style.outlineColor).toBe(colour('--rm-ring'));
    });
  });
});
