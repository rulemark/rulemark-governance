import { commands } from 'vitest/browser';

declare module 'vitest/browser' {
  interface BrowserCommands {
    setColorScheme: (scheme: 'light' | 'dark') => Promise<void>;
    parkPointer: () => Promise<void>;
  }
}

/** Emulates the OS's colour-scheme preference. */
export function setColorScheme(scheme: 'light' | 'dark'): Promise<void> {
  return commands.setColorScheme(scheme);
}

/** Moves the pointer off anything a test has rendered. */
export function parkPointer(): Promise<void> {
  return commands.parkPointer();
}

/** Sets, or with `undefined` removes, `data-theme` on `<html>`. */
export function setDataTheme(theme: 'light' | 'dark' | undefined): void {
  if (theme === undefined) document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = theme;
}

/**
 * A colour as the browser computes it (`rgb(77, 124, 15)`, `oklch(...)`), so
 * two colours compare equal however they were written. Takes a literal colour
 * or `--a-custom-property`, which resolves under the current theme.
 */
export function colour(value: string): string {
  // An undefined custom property doesn't fail: the probe would inherit its
  // parent's colour, and two misspelled names would compare equal.
  if (value.startsWith('--')) {
    const defined = getComputedStyle(document.documentElement).getPropertyValue(value);
    if (defined.trim() === '') throw new Error(`${value} is not defined`);
  }
  const probe = document.createElement('div');
  probe.style.color = value.startsWith('--') ? `var(${value})` : value;
  document.body.append(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  return computed;
}

/** One computed colour property of an element. */
export function paint(
  element: Element,
  property:
    'backgroundColor' | 'color' | 'borderTopColor' | 'borderBottomColor' | 'fill' | 'outlineColor',
): string {
  return getComputedStyle(element)[property];
}
