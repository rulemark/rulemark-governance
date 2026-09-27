import type {
  ControllersServed,
  ReportControllerActivity,
  ReportEngagement,
  ReportProcessorActivity,
  ReportResponse,
} from '@rulemark/ropa-schemas';

import { MECHANISMS, humanDuration } from './markdown.js';

/**
 * The Art. 30 record as CSV (`ropa-api.md` §5.1), rendered from the JSON
 * report like the Markdown, so the formats cannot disagree. It is made to be
 * opened in a spreadsheet by whoever answers a questionnaire or a regulator
 * (step 5, open questions 1–2):
 * - **One table**, a row per activity × engagement: the activity's columns
 *   repeat on each of its engagements, and an activity with none has a row of
 *   its own. Controller and processor activities share the table, each role
 *   leaving the other's columns empty. The closing subprocessor list is left
 *   out: the rows hold it, and `/subprocessors` serves it.
 * - **Dated and attributed on every row**: `asOf`, `generatedAt` and the
 *   organisation keeping the record are columns, since the file most likely
 *   to be handed over as evidence may be renamed or cut apart.
 * - **Spreadsheet-safe**: a UTF-8 byte-order mark, so Excel reads "Zürich"
 *   right; a cell that would start a formula gets a leading `'` (OWASP); and
 *   otherwise RFC 4180, with CRLF.
 */

const BOM = '﻿';

/** A cell a spreadsheet would run as a formula. */
const FORMULA = /^[=+\-@\t\r]/;

function field(value: string): string {
  const safe = FORMULA.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const list = (items: readonly string[]) => items.join('; ');
const names = (refs: readonly { name: string }[]) => list(refs.map((ref) => ref.name));

function dataCategories(categories: ReportControllerActivity['dataCategories']): string {
  return list(
    categories.map((category) => {
      if (category.special === 'art9') return `${category.name} (Art. 9)`;
      if (category.special === 'art10') return `${category.name} (Art. 10)`;
      return category.name;
    }),
  );
}

/** `IN: SCCs via Helpdesk Partners Pvt Ltd`. */
function transfers(items: ReportEngagement['transfers']): string {
  return list(
    items.map((transfer) => {
      const mechanism = MECHANISMS[transfer.mechanism] ?? transfer.mechanism;
      const onward = transfer.onwardVia === null ? '' : ` via ${transfer.onwardVia}`;
      return `${transfer.destinationCountry}: ${mechanism}${onward}`;
    }),
  );
}

function retention(rules: ReportControllerActivity['retentionRules']): string {
  return list(
    rules.map((rule) => {
      const legal = rule.legalRef === null ? '' : ` (${rule.legalRef})`;
      return `${rule.dataCategory?.name ?? 'All other data'}: ${humanDuration(rule.retentionPeriod)} ${rule.triggerEvent}${legal}`;
    }),
  );
}

function controllers(served: ControllersServed, activity: ReportProcessorActivity): string {
  switch (served.kind) {
    case 'client':
      return served.client.name;
    case 'standard':
      return activity.optionalModule
        ? `clients of ${activity.offering.name} on ${served.terms.name} who enable this module`
        : `all clients of ${activity.offering.name} on ${served.terms.name}`;
    case 'covered':
      return names(served.clients);
  }
}

type Row = Record<(typeof COLUMNS)[number], string>;

const COLUMNS = [
  'asOf',
  'generatedAt',
  // Art. 30(1)(a): who keeps the record. Empty until the self party is recorded.
  'organisation',
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
  // Controller activities, Art. 30(1).
  'purposes',
  'lawfulBases',
  'specialConditions',
  'retention',
  'dpiaRequired',
  'dpiaRef',
  // Processor activities, Art. 30(2).
  'offering',
  'clientCoverage',
  'optionalModule',
  'controllers',
  'processingCategories',
  'dpiaSupportRef',
  // The engagement: a recipient, or a subprocessor.
  'engagementParty',
  'engagementRole',
  'engagementService',
  'engagementCountries',
  'engagementTransfers',
  'engagementDataCategories',
] as const;

const EMPTY = Object.fromEntries(COLUMNS.map((column) => [column, ''])) as Row;

function activityColumns(
  report: ReportResponse,
  activity: ReportControllerActivity | ReportProcessorActivity,
): Partial<Row> {
  return {
    asOf: report.asOf ?? '',
    generatedAt: report.generatedAt,
    organisation: report.organisation?.legalName ?? '',
    activityCode: activity.code,
    activityName: activity.name,
    activityDescription: activity.description ?? '',
    owner: activity.owner,
    startedAt: activity.startedAt ?? '',
    reviewDueAt: activity.reviewDueAt ?? '',
    subjectCategories: names(activity.subjectCategories),
    dataCategories: dataCategories(activity.dataCategories),
    securityMeasures: names(activity.securityMeasures),
  };
}

function engagementColumns(engagement: ReportEngagement): Partial<Row> {
  return {
    engagementParty: engagement.party.name,
    engagementRole: engagement.role,
    engagementService: engagement.service,
    engagementCountries: list(engagement.processingCountries),
    engagementTransfers: transfers(engagement.transfers),
    engagementDataCategories: names(engagement.dataCategories),
  };
}

/** The activity's row once per engagement, or once alone if it has none. */
function perEngagement(activity: Partial<Row>, engagements: readonly ReportEngagement[]): Row[] {
  const rows = engagements.length === 0 ? [{}] : engagements.map(engagementColumns);
  return rows.map((engagement) => ({ ...EMPTY, ...activity, ...engagement }));
}

export function renderReportCsv(report: ReportResponse): string {
  const rows = [
    ...report.controllerActivities.flatMap((activity) =>
      perEngagement(
        {
          ...activityColumns(report, activity),
          activityRole: 'controller',
          purposes: list(activity.purposes),
          lawfulBases: list(activity.lawfulBases),
          specialConditions: list(activity.specialConditions),
          retention: retention(activity.retentionRules),
          dpiaRequired: String(activity.dpiaRequired),
          dpiaRef: activity.dpiaRef ?? '',
        },
        activity.recipients,
      ),
    ),
    ...report.processorActivities.flatMap((activity) =>
      perEngagement(
        {
          ...activityColumns(report, activity),
          activityRole: 'processor',
          offering: activity.offering.name,
          clientCoverage: activity.clientCoverage,
          optionalModule: String(activity.optionalModule),
          controllers: controllers(activity.controllers, activity),
          processingCategories: list(activity.processingCategories),
          dpiaSupportRef: activity.dpiaSupportRef ?? '',
        },
        activity.subprocessors,
      ),
    ),
  ];

  const lines = [
    COLUMNS.join(','),
    ...rows.map((row) => COLUMNS.map((column) => field(row[column])).join(',')),
  ];
  return `${BOM}${lines.map((line) => `${line}\r\n`).join('')}`;
}

/**
 * `ropa-<view>[-<offering or client>]-<date>.csv`: the date the record is
 * read as of (a timestamp's UTC date, as the views judge it, §5), or today's.
 */
export function reportCsvFilename(report: ReportResponse): string {
  const { view, offering, client } = report.scope;
  const scope = client ?? offering;
  const date =
    report.asOf === null
      ? report.generatedAt.slice(0, 10)
      : new Date(report.asOf).toISOString().slice(0, 10);
  const parts = ['ropa', view, ...(scope === null ? [] : [scope.slug ?? scope.id]), date];
  return `${parts.join('-')}.csv`;
}
