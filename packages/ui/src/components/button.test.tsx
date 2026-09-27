import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import { Button } from './button';

// The colour a CSS custom property of the theme paints as a background, read
// off a probe element so the comparison is between two computed colours.
function themeColour(variable: string): string {
  const probe = document.createElement('div');
  probe.style.backgroundColor = `var(${variable})`;
  document.body.append(probe);
  const colour = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return colour;
}

const transparent = 'rgba(0, 0, 0, 0)';

afterEach(() => {
  document.documentElement.classList.remove('dark');
});

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
    await expect.element(button).not.toHaveClass('h-8');
  });

  describe('the theme', () => {
    it('paints the default button in the primary colour', async () => {
      const screen = await render(<Button>Save</Button>);

      const background = getComputedStyle(
        screen.getByRole('button', { name: 'Save' }).element(),
      ).backgroundColor;

      expect(background).not.toBe(transparent);
      expect(background).toBe(themeColour('--primary'));
    });

    it('switches to the dark palette under a .dark ancestor', async () => {
      const light = themeColour('--primary');
      document.documentElement.classList.add('dark');

      const screen = await render(<Button>Save</Button>);
      const background = getComputedStyle(
        screen.getByRole('button', { name: 'Save' }).element(),
      ).backgroundColor;

      expect(background).not.toBe(light);
      expect(background).toBe(themeColour('--primary'));
    });
  });
});
