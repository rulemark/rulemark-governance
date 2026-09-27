import type { ReportResponse } from '@rulemark/ropa-schemas';

/**
 * Reads a CSV back as a spreadsheet would (RFC 4180): quoted fields may hold
 * commas, doubled quotes and line breaks; records end in CRLF. Strict, so a
 * malformed file fails the test that reads it rather than parsing loosely.
 */
export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const character = text[i]!;
    if (quoted) {
      if (character === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
      } else if (character === '"') {
        quoted = false;
        i += 1;
      } else {
        field += character;
        i += 1;
      }
    } else if (character === '"' && field === '') {
      quoted = true;
      i += 1;
    } else if (character === ',') {
      record.push(field);
      field = '';
      i += 1;
    } else if (character === '\r' && text[i + 1] === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      i += 2;
    } else if (character === '"' || character === '\n' || character === '\r') {
      throw new Error(`Unexpected ${JSON.stringify(character)} outside quotes at ${i}`);
    } else {
      field += character;
      i += 1;
    }
  }
  if (quoted) throw new Error('Unterminated quoted field');
  if (field !== '' || record.length > 0) throw new Error('The last record has no CRLF');
  return records;
}

/** The records after the header, each keyed by its column. */
export function csvRows(text: string): Record<string, string>[] {
  const [header, ...records] = parseCsv(text);
  if (header === undefined) throw new Error('No header row');
  return records.map((record) => {
    if (record.length !== header.length) {
      throw new Error(`A record of ${record.length} fields under ${header.length} columns`);
    }
    return Object.fromEntries(header.map((column, index) => [column, record[index]!]));
  });
}

/**
 * What a report holds, one line per activity × engagement (an activity with
 * none on a line of its own), so a CSV can be checked against its JSON.
 */
export function reportLines(report: ReportResponse): string[] {
  const activities = [
    ...report.controllerActivities.map((activity) => ({
      ...activity,
      engagements: activity.recipients,
    })),
    ...report.processorActivities.map((activity) => ({
      ...activity,
      engagements: activity.subprocessors,
    })),
  ];
  return activities.flatMap((activity) =>
    activity.engagements.length === 0
      ? [`${activity.code} ·  · `]
      : activity.engagements.map(
          (engagement) => `${activity.code} · ${engagement.party.name} · ${engagement.service}`,
        ),
  );
}

/** The same lines, read from a CSV's rows. */
export function csvLines(rows: readonly Record<string, string>[]): string[] {
  return rows.map(
    (row) => `${row['activityCode']} · ${row['engagementParty']} · ${row['engagementService']}`,
  );
}
