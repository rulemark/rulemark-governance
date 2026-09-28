import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';

import { colour, paint, setDataTheme } from '../test-support';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './table';

// shadcn's base-nova table, restyled to the foundations: rows, cell padding
// and header type from rulemark-foundations.css, colours from the palette.

async function renderTable(rows = [['P1', 'Candidate application management']]) {
  const screen = await render(
    <Table>
      <TableCaption>Processing activities</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Code</TableHead>
          <TableHead>Name</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(([code, name]) => (
          <TableRow key={code}>
            <TableCell>{code}</TableCell>
            <TableCell>{name}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>,
  );
  return {
    screen,
    table: screen.getByRole('table').element(),
    container: screen.getByRole('table').element().parentElement!,
    head: screen.getByRole('columnheader', { name: 'Code' }).element(),
    cell: screen.getByRole('cell', { name: 'P1' }).element(),
    row: screen.getByRole('row', { name: /P1/ }),
  };
}

describe('Table', () => {
  it('is a real table, named by its caption', async () => {
    const { screen } = await renderTable();

    await expect
      .element(screen.getByRole('table', { name: 'Processing activities' }))
      .toBeVisible();
    expect(screen.getByRole('columnheader').elements()).toHaveLength(2);
  });

  it('sets rows at the row height, cells at the cell padding', async () => {
    const { cell, head } = await renderTable();

    expect(cell.getBoundingClientRect().height).toBe(44);
    expect(getComputedStyle(cell).paddingLeft).toBe('16px');
    expect(getComputedStyle(head).paddingLeft).toBe('16px');
  });

  it('sets headers as small labels, body cells as body text', async () => {
    const { cell, head } = await renderTable();

    expect(getComputedStyle(head)).toMatchObject({
      fontSize: '12px',
      lineHeight: '16px',
      fontWeight: '500',
      textAlign: 'left',
    });
    expect(getComputedStyle(cell)).toMatchObject({ fontSize: '14px', lineHeight: '22px' });
  });

  it('lines up numbers', async () => {
    const { table } = await renderTable();

    expect(getComputedStyle(table).fontVariantNumeric).toBe('tabular-nums');
  });

  it('scrolls sideways inside its container when it is too wide', async () => {
    const { container } = await renderTable();

    expect(getComputedStyle(container).overflowX).toBe('auto');
  });

  it('has the card radius', async () => {
    const { container } = await renderTable();

    expect(getComputedStyle(container).borderTopLeftRadius).toBe('12px');
  });

  describe.each(['light', 'dark'] as const)('in the %s theme', (theme) => {
    it('sits on the surface, bordered, with muted headers', async () => {
      setDataTheme(theme);
      const { container, head } = await renderTable();

      expect(paint(container, 'backgroundColor')).toBe(colour('--rm-surface'));
      expect(paint(container, 'borderTopColor')).toBe(colour('--rm-border'));
      expect(paint(head, 'color')).toBe(colour('--rm-fg-muted'));
    });

    it('divides rows subtly, and highlights the one under the pointer', async () => {
      setDataTheme(theme);
      const { row, head } = await renderTable([
        ['P1', 'Candidate application management'],
        ['P2', 'Diversity & accommodations module'],
      ]);

      expect(paint(head.parentElement!, 'borderBottomColor')).toBe(colour('--rm-border-subtle'));
      await row.hover();
      await expect
        .poll(() => paint(row.element(), 'backgroundColor'))
        .toBe(colour('--rm-surface-hover'));
    });
  });
});
