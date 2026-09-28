'use client';

import { cn } from '@rulemark/ui/lib/utils';
import * as React from 'react';

// shadcn's base-nova table, restyled to the Rulemark foundations: a card-
// radius container on the surface, rows at the row height, cells at the cell
// padding, headers as small muted labels, and rows divided subtly. Headers
// carry `scope`, which shadcn's leave out.

function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto rounded-card border border-border bg-card"
    >
      <table
        data-slot="table"
        className={cn('w-full caption-bottom text-body', className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn('[&_tr]:border-b [&_tr]:border-border-subtle', className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        'border-t border-border-subtle bg-surface-sunken font-medium [&>tr]:last:border-b-0',
        className,
      )}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'border-b border-border-subtle transition-colors hover:bg-surface-hover has-aria-expanded:bg-surface-hover data-[state=selected]:bg-surface-active',
        className,
      )}
      {...props}
    />
  );
}

// A column header unless told otherwise (`scope="row"` for a row's): without
// a scope, browsers may expose a <th> as a plain cell, and a screen reader
// doesn't announce it with the column's cells.
function TableHead({ className, scope = 'col', ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      scope={scope}
      className={cn(
        'h-row-compact px-cell-x text-left align-middle text-label-sm whitespace-nowrap text-fg-muted [&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        'h-row px-cell-x align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('mt-4 text-caption text-fg-muted', className)}
      {...props}
    />
  );
}

export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow };
