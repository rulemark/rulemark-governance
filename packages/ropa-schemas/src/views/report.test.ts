import { describe, expect, it } from 'vitest';

import { fieldErrorsFromZod } from '../errors.ts';
import { ReportQuery, ReportResponse } from './report.ts';

describe('ReportResponse.asOf', () => {
  it('echoes the asOf asked for: a date, a timestamp, or null for today', () => {
    for (const asOf of ['2026-03-01', '2026-03-16T15:00:00+01:00', null]) {
      expect(ReportResponse.shape.asOf.safeParse(asOf).success).toBe(true);
    }
    expect(ReportResponse.shape.asOf.safeParse('1 March').success).toBe(false);
  });
});

describe('ReportQuery (§5.1)', () => {
  it('defaults to JSON and leaves the view to the scope', () => {
    expect(ReportQuery.parse({})).toEqual({ format: 'json' });
    expect(ReportQuery.parse({ offering: 'ats', format: 'markdown' })).toEqual({
      offering: 'ats',
      format: 'markdown',
    });
  });

  it('refuses both scopes at once', () => {
    const result = ReportQuery.safeParse({ offering: 'ats', client: 'aurelia' });
    expect(fieldErrorsFromZod(result.error!).map((error) => error.code)).toEqual([
      'offering_or_client',
    ]);
  });

  it('refuses a scoped report that asks for Hireloop’s own controller records', () => {
    for (const view of ['controller', 'all']) {
      const result = ReportQuery.safeParse({ client: 'aurelia', view });
      expect(fieldErrorsFromZod(result.error!)).toEqual([
        expect.objectContaining({ path: '/view', code: 'scope_needs_processor_view' }),
      ]);
    }
    expect(ReportQuery.safeParse({ client: 'aurelia', view: 'processor' }).success).toBe(true);
  });

  it('knows only its three formats', () => {
    expect(ReportQuery.safeParse({ format: 'pdf' }).success).toBe(false);
  });
});
