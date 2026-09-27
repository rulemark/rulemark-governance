import type { ReportResponse } from '@rulemark/ropa-schemas';
import { describe, expect, it } from 'vitest';

import { csvRows, parseCsv } from '../../../test/fixtures/csv.js';
import { OFFERING_REPORT, REPORT, ref } from '../../../test/fixtures/report.js';
import { renderReportCsv, reportCsvFilename } from './csv.js';

/**
 * The CSV report (`ropa-api.md` §5.1; step 5, open questions 1–2): one table,
 * a row per activity × engagement, for the people who answer questionnaires
 * and regulators in a spreadsheet. Rendered from the JSON report, like the
 * Markdown, so the formats cannot disagree.
 */

const HEADER = [
  'asOf',
  'generatedAt',
  'activityRole',
  'activityCode',
  'activityName',
  'activityDescription',
  'owner',
  'startedAt',
  'reviewDueAt',
  'subjectCategories',
  'dataCategories',
  'securityMeasures',
  'purposes',
  'lawfulBases',
  'specialConditions',
  'retention',
  'dpiaRequired',
  'dpiaRef',
  'offering',
  'clientCoverage',
  'optionalModule',
  'controllers',
  'processingCategories',
  'dpiaSupportRef',
  'engagementParty',
  'engagementRole',
  'engagementService',
  'engagementCountries',
  'engagementTransfers',
  'engagementDataCategories',
].join(',');

const BOM = '﻿';

/** The body without its byte-order mark, as a spreadsheet reads it. */
const text = (report: ReportResponse) => {
  const csv = renderReportCsv(report);
  expect(csv.startsWith(BOM)).toBe(true);
  return csv.slice(1);
};
const rows = (report: ReportResponse) => csvRows(text(report));

const p1 = OFFERING_REPORT.processorActivities[0]!;
const withP1 = (changes: Partial<typeof p1>): ReportResponse => ({
  ...OFFERING_REPORT,
  processorActivities: [{ ...p1, ...changes }],
});

describe('renderReportCsv', () => {
  it('renders the record as one table, a row per activity × engagement, exactly (golden)', () => {
    expect(renderReportCsv(REPORT)).toBe(
      [
        `${BOM}${HEADER}`,
        ',2026-09-26T10:00:00.000Z,controller,C2,Customer accounts & billing,"Accounts for client users, and invoicing.",Priya Raman,2026-02-10,2027-02-10,Candidates,Billing data; Health data (Art. 9),Encryption at rest,Provide contracted service accounts; Invoice and collect payment,6(1)(b); 6(1)(c),9(2)(b),Billing data: 7 years after invoice date (Dutch tax law); All other data: 90 days after contract end,false,,,,,,,,Ledgerpay Ltd,recipient,Payment processing,IE,,Billing data',
        ',2026-09-26T10:00:00.000Z,processor,P1,Candidate application management,,Priya Raman,2026-02-10,,Candidates,Identity & contact,Encryption at rest,,,,,,,Hireloop ATS,all_enrolled,false,all clients of Hireloop ATS on Standard DPA v3,hosting; candidate notifications,,"Render Services, Inc.",subprocessor,Hosting,DE,,Identity & contact',
        ',2026-09-26T10:00:00.000Z,processor,P1,Candidate application management,,Priya Raman,2026-02-10,,Candidates,Identity & contact,Encryption at rest,,,,,,,Hireloop ATS,all_enrolled,false,all clients of Hireloop ATS on Standard DPA v3,hosting; candidate notifications,,Mailcrest Inc.,subprocessor,Candidate notifications (US region),US,US: DPF,Identity & contact',
        ',2026-09-26T10:00:00.000Z,processor,P2,Diversity & accommodations module,,Priya Raman,2026-03-16,,Candidates,Health data (Art. 9),Encryption at rest,,,,,,,Hireloop ATS,opt_in,true,clients of Hireloop ATS on Standard DPA v3 who enable this module,storage,DPIA-SUPPORT-DIVERSITY,"Render Services, Inc.",subprocessor,Hosting,DE,,Health data',
        '',
      ].join('\r\n'),
    );
  });

  it('leaves out the closing subprocessor list: the rows hold it', () => {
    expect(parseCsv(text(OFFERING_REPORT))).toHaveLength(1 + 3);
  });

  it('gives an activity with no engagements one row of its own', () => {
    const [row, ...rest] = rows(withP1({ subprocessors: [] }));
    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({ activityCode: 'P1', engagementParty: '', engagementService: '' });
  });

  it('puts asOf on every row, so the date survives a rename of the file', () => {
    const then = rows({ ...REPORT, asOf: '2026-03-01' });
    expect(then.map((row) => row.asOf)).toEqual(Array(4).fill('2026-03-01'));
    expect(new Set(then.map((row) => row.generatedAt))).toEqual(
      new Set(['2026-09-26T10:00:00.000Z']),
    );
  });

  it('writes a transfer as country, mechanism and onward party', () => {
    const [row] = rows(
      withP1({
        subprocessors: [
          {
            ...p1.subprocessors[1]!,
            transfers: [
              { destinationCountry: 'US', mechanism: 'dpf', onwardVia: null },
              {
                destinationCountry: 'IN',
                mechanism: 'sccs',
                onwardVia: 'Helpdesk Partners Pvt Ltd',
              },
            ],
          },
        ],
      }),
    );
    expect(row!.engagementTransfers).toBe('US: DPF; IN: SCCs via Helpdesk Partners Pvt Ltd');
  });

  it('names the controllers served: one client, or every client covered', () => {
    const aurelia = ref(30, 'aurelia', 'Aurelia Bank S.A.');
    const fjord = ref(31, 'fjord', 'Fjord Talent AS');
    const served = (controllers: typeof p1.controllers) =>
      rows(withP1({ controllers }))[0]!.controllers;
    expect(served({ kind: 'client', client: aurelia })).toBe('Aurelia Bank S.A.');
    expect(served({ kind: 'covered', clients: [aurelia, fjord] })).toBe(
      'Aurelia Bank S.A.; Fjord Talent AS',
    );
    expect(served({ kind: 'covered', clients: [] })).toBe('');
  });

  it('marks criminal-convictions data', () => {
    const convictions = {
      ...ref(32, 'convictions', 'Criminal records'),
      special: 'art10' as const,
    };
    expect(rows(withP1({ dataCategories: [convictions] }))[0]!.dataCategories).toBe(
      'Criminal records (Art. 10)',
    );
  });

  it('quotes a field holding a comma, a quote or a line break, and reads back the same', () => {
    const description = 'Parses CVs, "fast".\nSecond line';
    const csv = text(withP1({ description }));
    expect(csv).toContain('"Parses CVs, ""fast"".\nSecond line"');
    expect(csvRows(csv)[0]!.activityDescription).toBe(description);
  });

  it.each([
    ['=HYPERLINK("https://evil.example","Click")'],
    ['+1+1'],
    ['-1+1'],
    ['@SUM(A1:A9)'],
    ['\t=1+1'],
    ['\r=1+1'],
  ])('keeps %j from running as a formula', (name) => {
    const [row] = rows(withP1({ name }));
    expect(row!.activityName).toBe(`'${name}`);
  });

  it('leaves text that only contains a formula character alone', () => {
    const [row] = rows(withP1({ name: 'Scoring = rank + fit' }));
    expect(row!.activityName).toBe('Scoring = rank + fit');
  });

  it('renders the same report to the same text, twice', () => {
    expect(renderReportCsv(REPORT)).toBe(renderReportCsv(structuredClone(REPORT)));
  });
});

describe('reportCsvFilename', () => {
  const aurelia = ref(30, 'aurelia', 'Aurelia Bank S.A.');

  it.each<[string, Partial<ReportResponse>, string]>([
    ['the whole record today', {}, 'ropa-all-2026-09-26.csv'],
    ['the whole record as of a date', { asOf: '2026-03-01' }, 'ropa-all-2026-03-01.csv'],
    [
      'a timestamp, by its UTC date',
      { asOf: '2026-03-01T23:30:00-02:00' },
      'ropa-all-2026-03-02.csv',
    ],
    [
      'the controller view',
      { scope: { view: 'controller', offering: null, client: null, terms: null } },
      'ropa-controller-2026-09-26.csv',
    ],
    [
      'an offering’s standard terms',
      { scope: OFFERING_REPORT.scope },
      'ropa-processor-ats-2026-09-26.csv',
    ],
    [
      'one client',
      { asOf: '2026-05-01', scope: { ...OFFERING_REPORT.scope, client: aurelia } },
      'ropa-processor-aurelia-2026-05-01.csv',
    ],
  ])('names %s', (_, changes, filename) => {
    expect(reportCsvFilename({ ...REPORT, ...changes })).toBe(filename);
  });
});
