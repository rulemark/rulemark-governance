import type { CnFunction } from 'cn';
import { createCn } from 'cn/config';

// shadcn's class merger (clsx and tailwind-merge in one), taught the
// foundations' names, so a later class wins over a conflicting earlier one:
// `h-control h-12` is `h-12`, and `text-label` survives beside a text colour
// instead of passing for one. The names are rulemark-foundations.css's; the
// tests check this list against the file.
//
// Components import `cn` from here, not from the `cn` package, which knows
// only Tailwind's defaults. `shadcn add` writes `from 'cn'`: lint points it
// here.
export const cn: CnFunction = createCn({
  extend: {
    theme: {
      text: [
        'display',
        'h1',
        'h2',
        'h3',
        'h4',
        'body-lg',
        'body',
        'body-sm',
        'label',
        'label-sm',
        'caption',
        'overline',
        'code',
      ],
      spacing: [
        'control-sm',
        'control',
        'control-lg',
        'control-x',
        'card',
        'cell-x',
        'gutter',
        'section',
        'stack',
        'header',
        'sidebar',
        'sidebar-collapsed',
        'row',
        'row-compact',
      ],
      radius: ['xs', 'badge', 'control', 'popover', 'card', 'dialog', 'pill'],
      container: ['form', 'dialog', 'reading', 'page'],
    },
  },
});
