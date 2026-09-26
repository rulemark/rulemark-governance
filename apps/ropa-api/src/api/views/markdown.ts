import type {
  ControllersServed,
  ReportControllerActivity,
  ReportEngagement,
  ReportProcessorActivity,
  ReportResponse,
  Subprocessor,
} from '@rulemark/ropa-schemas';

/**
 * The Art. 30 record as Markdown (`ropa-api.md` §5.1), rendered from the JSON
 * report so the two cannot disagree. Plain template strings: the output is
 * small and fixed, and a golden test holds it exactly.
 *
 * Two properties matter, because this feeds the architecture document:
 * - **Stable anchors.** Every activity heading follows `<a id="p3"></a>`,
 *   built from its code. Codes never change (DM §3.0), so a link to `…#p3`
 *   survives any rename.
 * - **Diffable.** Activities come in code order, every list in record order,
 *   and nothing but `generatedAt` changes between two exports of the same
 *   record.
 */

/** Text from the record, made safe to place in Markdown. */
function inline(text: string): string {
  return text
    .replaceAll(/[\\`*_[\]<>]/g, (character) => `\\${character}`)
    .replaceAll(/\s*\n\s*/g, ' ');
}

/** Inline text that also sits inside a table cell. */
function cell(text: string): string {
  return inline(text).replaceAll('|', '\\|');
}

const NONE = '—';
const list = (items: readonly string[], separator = ', ') =>
  items.length === 0 ? NONE : items.map(inline).join(separator);
const cellList = (items: readonly string[], separator = ', ') =>
  items.length === 0 ? NONE : items.map(cell).join(separator);

const anchor = (code: string) => code.toLowerCase();
const link = (code: string) => `[${code}](#${anchor(code)})`;

function table(headers: readonly string[], rows: readonly string[][]): string {
  return [
    `| ${headers.join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

const MECHANISMS: Readonly<Record<string, string>> = {
  adequacy: 'adequacy decision',
  dpf: 'DPF',
  sccs: 'SCCs',
  bcr: 'BCRs',
  derogation_49: 'Art. 49 derogation',
};

function transfers(items: ReportEngagement['transfers']): string {
  if (items.length === 0) return NONE;
  return items
    .map((transfer) => {
      const onward = transfer.onwardVia === null ? '' : `, onward via ${cell(transfer.onwardVia)}`;
      return `${transfer.destinationCountry} (${MECHANISMS[transfer.mechanism] ?? transfer.mechanism}${onward})`;
    })
    .join('; ');
}

const UNITS: readonly [string, string][] = [
  ['Y', 'year'],
  ['M', 'month'],
  ['W', 'week'],
  ['D', 'day'],
];

/** `P1Y6M` → "1 year 6 months". Retention periods have date components only. */
export function humanDuration(duration: string): string {
  const parts = UNITS.flatMap(([letter, unit]) => {
    const match = new RegExp(`(\\d+)${letter}`).exec(duration.replace(/^P/, ''));
    if (match === null) return [];
    const amount = Number(match[1]);
    return [`${amount} ${unit}${amount === 1 ? '' : 's'}`];
  });
  return parts.length === 0 ? duration : parts.join(' ');
}

function dataCategories(categories: ReportControllerActivity['dataCategories']): string {
  if (categories.length === 0) return NONE;
  return categories
    .map((category) => {
      const name = inline(category.name);
      if (category.special === 'art9') return `${name} (special category, Art. 9)`;
      if (category.special === 'art10') return `${name} (criminal convictions, Art. 10)`;
      return name;
    })
    .join(', ');
}

function heading(activity: { code: string; name: string }): string[] {
  return [
    `<a id="${anchor(activity.code)}"></a>`,
    `### ${activity.code} · ${inline(activity.name)}`,
  ];
}

function ownerLine(activity: ReportControllerActivity | ReportProcessorActivity): string {
  const parts = [inline(activity.owner)];
  if (activity.startedAt !== null) parts.push(`since ${activity.startedAt}`);
  if (activity.reviewDueAt !== null) parts.push(`next review ${activity.reviewDueAt}`);
  return `- **Owner:** ${parts.join(' · ')}`;
}

function controllerActivity(activity: ReportControllerActivity): string {
  const facts = [
    `- **Purposes:** ${list(activity.purposes, '; ')}`,
    `- **Lawful bases:** ${list(activity.lawfulBases.map((basis) => `Art. ${basis}`))}`,
    ...(activity.specialConditions.length === 0
      ? []
      : [
          `- **Special-category conditions:** ${list(
            activity.specialConditions.map((condition) =>
              condition === 'art10' ? 'Art. 10' : `Art. ${condition}`,
            ),
          )}`,
        ]),
    `- **Data subjects:** ${list(activity.subjectCategories.map((category) => category.name))}`,
    `- **Personal data:** ${dataCategories(activity.dataCategories)}`,
    `- **Security measures:** ${list(activity.securityMeasures.map((measure) => measure.name))}`,
    `- **DPIA:** ${activity.dpiaRequired ? `required${activity.dpiaRef === null ? '' : ` (${inline(activity.dpiaRef)})`}` : 'not required'}`,
    ownerLine(activity),
  ];

  const recipients =
    activity.recipients.length === 0
      ? 'No recipients.'
      : table(
          ['Recipient', 'Role', 'Service', 'Countries', 'Transfers'],
          activity.recipients.map((recipient) => [
            cell(recipient.party.name),
            recipient.role.replaceAll('_', ' '),
            cell(recipient.service),
            cellList(recipient.processingCountries),
            transfers(recipient.transfers),
          ]),
        );

  const retention =
    activity.retentionRules.length === 0
      ? 'No retention rules.'
      : table(
          ['Retention of', 'Period', 'From', 'Legal reference'],
          activity.retentionRules.map((rule) => [
            rule.dataCategory === null ? 'All other data' : cell(rule.dataCategory.name),
            humanDuration(rule.retentionPeriod),
            cell(rule.triggerEvent),
            rule.legalRef === null ? NONE : cell(rule.legalRef),
          ]),
        );

  return [
    heading(activity).join('\n'),
    ...(activity.description === null ? [] : [inline(activity.description)]),
    facts.join('\n'),
    recipients,
    retention,
  ].join('\n\n');
}

function controllers(served: ControllersServed, activity: ReportProcessorActivity): string {
  switch (served.kind) {
    case 'client':
      return inline(served.client.name);
    case 'standard':
      return activity.optionalModule
        ? `clients of ${inline(activity.offering.name)} on ${inline(served.terms.name)} who enable this module`
        : `all clients of ${inline(activity.offering.name)} on ${inline(served.terms.name)}`;
    case 'covered':
      return served.clients.length === 0
        ? 'no client at the moment'
        : list(served.clients.map((client) => client.name));
  }
}

function processorActivity(activity: ReportProcessorActivity): string {
  const facts = [
    `- **Controllers:** ${controllers(activity.controllers, activity)}`,
    `- **Categories of processing:** ${list(activity.processingCategories)}`,
    `- **Data subjects:** ${list(activity.subjectCategories.map((category) => category.name))}`,
    `- **Personal data:** ${dataCategories(activity.dataCategories)}`,
    `- **Security measures:** ${list(activity.securityMeasures.map((measure) => measure.name))}`,
    ...(activity.dpiaSupportRef === null
      ? []
      : [`- **DPIA support:** ${inline(activity.dpiaSupportRef)}`]),
    ownerLine(activity),
  ];

  const subprocessors =
    activity.subprocessors.length === 0
      ? 'No subprocessors.'
      : table(
          ['Subprocessor', 'Service', 'Countries', 'Transfers'],
          activity.subprocessors.map((engagement) => [
            cell(engagement.party.name),
            cell(engagement.service),
            cellList(engagement.processingCountries),
            transfers(engagement.transfers),
          ]),
        );

  return [
    heading(activity).join('\n'),
    ...(activity.description === null ? [] : [inline(activity.description)]),
    facts.join('\n'),
    subprocessors,
  ].join('\n\n');
}

function subprocessorTable(entries: readonly Subprocessor[]): string {
  if (entries.length === 0) return 'No subprocessors.';
  return table(
    ['Subprocessor', 'Services', 'Countries', 'Transfers', 'Activities'],
    entries.map((entry) => [
      cell(entry.party.name),
      cellList(entry.services),
      cellList(entry.processingCountries),
      transfers(entry.transfers),
      entry.activities.map((activity) => link(activity.code)).join(', '),
    ]),
  );
}

function scopeSentence(report: ReportResponse): string {
  const { view, offering, client, terms } = report.scope;
  if (client !== null) {
    return `processor activities as they apply to ${inline(client.name)}${terms === null ? '' : `, under ${inline(terms.name)}`}.`;
  }
  if (offering !== null) {
    return `processor activities of ${inline(offering.name)} under its standard terms${terms === null ? '' : ` (${inline(terms.name)})`}.`;
  }
  if (view === 'controller') return 'controller activities.';
  if (view === 'processor') return 'processor activities, for every client they cover.';
  return 'the whole record.';
}

function organisation(report: ReportResponse): string[] {
  const org = report.organisation;
  if (org === null)
    return ['_The organisation keeping this record (the self party) is not recorded yet._'];
  const contact = [org.contactName, org.contactEmail].filter(
    (part): part is string => part !== null,
  );
  const dpo = [org.dpoName, org.dpoEmail].filter((part): part is string => part !== null);
  return [
    `**${inline(org.legalName)}** (${org.country})`,
    ...(contact.length === 0 ? [] : [`Contact: ${contact.map(inline).join(', ')}`]),
    ...(dpo.length === 0 ? [] : [`Data protection officer: ${dpo.map(inline).join(', ')}`]),
  ];
}

export function renderReportMarkdown(report: ReportResponse): string {
  const { view } = report.scope;
  const blocks = [
    '# Record of processing activities',
    ...organisation(report),
    `Generated ${report.generatedAt}.${report.asOf === null ? '' : ` As of ${report.asOf}.`} Scope: ${scopeSentence(report)}`,
  ];

  if (view !== 'processor') {
    blocks.push('## Controller activities (Art. 30(1))');
    blocks.push(
      ...(report.controllerActivities.length === 0
        ? ['None recorded.']
        : report.controllerActivities.map(controllerActivity)),
    );
  }
  if (view !== 'controller') {
    blocks.push('## Processor activities (Art. 30(2))');
    blocks.push(
      ...(report.processorActivities.length === 0
        ? ['None recorded.']
        : report.processorActivities.map(processorActivity)),
    );
  }

  const closing = report.subprocessors;
  if (closing !== null) {
    blocks.push('## Subprocessors', subprocessorTable(closing.subprocessors));
    if (closing.optionalModules.length > 0) {
      blocks.push('### Optional modules');
      for (const module of closing.optionalModules) {
        blocks.push(
          `#### ${link(module.activity.code)} · ${inline(module.activity.name)}`,
          subprocessorTable(module.subprocessors),
        );
      }
    }
  }

  return `${blocks.join('\n\n')}\n`;
}
