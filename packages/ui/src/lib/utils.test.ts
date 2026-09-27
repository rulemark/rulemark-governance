import { describe, expect, it } from 'vitest';

import foundations from '../styles/rulemark-foundations.css?raw';
import { cn } from './utils';

// `cn` resolves conflicting classes, the later one winning. It has to know
// the foundations' names to see a conflict: otherwise `h-control` and `h-12`
// both stay (the CSS decides, not the caller), and `text-label` passes for a
// text colour and is dropped beside `text-primary-fg`.

/** The names in one of the foundations' namespaces, `--text-h2` giving `h2`. */
function names(namespace: string): string[] {
  const pattern = new RegExp(`^\\s*--${namespace}-([a-z0-9-]+?):`, 'gm');
  return [...foundations.matchAll(pattern)]
    .map((match) => match[1]!)
    .filter((name) => !name.includes('--'));
}

describe('cn', () => {
  it('keeps a type step beside a text colour', () => {
    expect(cn('text-label', 'text-primary-fg')).toBe('text-label text-primary-fg');
  });

  it('lets a later type step win', () => {
    expect(cn('text-label', 'text-label-sm')).toBe('text-label-sm');
  });

  it('reads every name the foundations define', () => {
    // A guard on the parsing itself: v1 defines 13 type steps.
    expect(names('text')).toHaveLength(13);
    expect(names('spacing').length).toBeGreaterThan(10);
  });

  it.each(names('text'))('knows text-%s as a font size', (name) => {
    expect(cn(`text-${name}`, 'text-sm')).toBe('text-sm');
    expect(cn(`text-${name}`, 'text-fg-muted')).toBe(`text-${name} text-fg-muted`);
  });

  it.each(names('spacing'))('knows %s as a length', (name) => {
    expect(cn(`h-${name}`, 'h-12')).toBe('h-12');
    expect(cn(`px-${name}`, 'px-2')).toBe('px-2');
    expect(cn(`size-${name}`, 'size-4')).toBe('size-4');
  });

  it.each(names('radius'))('knows rounded-%s as a radius', (name) => {
    expect(cn(`rounded-${name}`, 'rounded-lg')).toBe('rounded-lg');
  });

  it.each(names('container'))('knows max-w-%s as a width', (name) => {
    expect(cn(`max-w-${name}`, 'max-w-sm')).toBe('max-w-sm');
  });
});
