import { describe, expect, it } from 'vitest';

import { OFFERING_REPORT, REPORT } from '../../../test/fixtures/report.js';
import { humanDuration, renderReportMarkdown } from './markdown.js';

/**
 * The Markdown report (`ropa-api.md` §5.1) feeds the architecture document, so
 * it must be stable: the same record renders to the same text, and a diff
 * between two exports shows what changed in the record and nothing else. The
 * golden test below fixes the output exactly.
 */

describe('renderReportMarkdown', () => {
  it('renders the Art. 30 record, exactly (golden)', () => {
    expect(renderReportMarkdown(REPORT)).toBe(`# Record of processing activities

**Hireloop B.V.** (NL)

Data protection officer: Priya Raman, dpo@hireloop.example

Generated 2026-09-26T10:00:00.000Z. Scope: the whole record.

## Controller activities (Art. 30(1))

<a id="c2"></a>
### C2 · Customer accounts & billing

Accounts for client users, and invoicing.

- **Purposes:** Provide contracted service accounts; Invoice and collect payment
- **Lawful bases:** Art. 6(1)(b), Art. 6(1)(c)
- **Special-category conditions:** Art. 9(2)(b)
- **Data subjects:** Candidates
- **Personal data:** Billing data, Health data (special category, Art. 9)
- **Security measures:** Encryption at rest
- **DPIA:** not required
- **Owner:** Priya Raman · since 2026-02-10 · next review 2027-02-10

| Recipient | Role | Service | Countries | Transfers |
|---|---|---|---|---|
| Ledgerpay Ltd | recipient | Payment processing | IE | — |

| Retention of | Period | From | Legal reference |
|---|---|---|---|
| Billing data | 7 years | after invoice date | Dutch tax law |
| All other data | 90 days | after contract end | — |

## Processor activities (Art. 30(2))

<a id="p1"></a>
### P1 · Candidate application management

- **Controllers:** all clients of Hireloop ATS on Standard DPA v3
- **Categories of processing:** hosting, candidate notifications
- **Data subjects:** Candidates
- **Personal data:** Identity & contact
- **Security measures:** Encryption at rest
- **Owner:** Priya Raman · since 2026-02-10

| Subprocessor | Service | Countries | Transfers |
|---|---|---|---|
| Render Services, Inc. | Hosting | DE | — |
| Mailcrest Inc. | Candidate notifications (US region) | US | US (DPF) |

<a id="p2"></a>
### P2 · Diversity & accommodations module

- **Controllers:** clients of Hireloop ATS on Standard DPA v3 who enable this module
- **Categories of processing:** storage
- **Data subjects:** Candidates
- **Personal data:** Health data (special category, Art. 9)
- **Security measures:** Encryption at rest
- **DPIA support:** DPIA-SUPPORT-DIVERSITY
- **Owner:** Priya Raman · since 2026-03-16

| Subprocessor | Service | Countries | Transfers |
|---|---|---|---|
| Render Services, Inc. | Hosting | DE | — |

## Subprocessors

| Subprocessor | Services | Countries | Transfers | Activities |
|---|---|---|---|---|
| Render Services, Inc. | Hosting | DE | — | [P1](#p1) |
| Mailcrest Inc. | Candidate notifications (US region) | US | US (DPF) | [P1](#p1) |

### Optional modules

#### [P2](#p2) · Diversity & accommodations module

| Subprocessor | Services | Countries | Transfers | Activities |
|---|---|---|---|---|
| Render Services, Inc. | Hosting | DE | — | [P2](#p2) |
`);
  });

  it('names the scope of an offering report, and leaves the controller section out', () => {
    const markdown = renderReportMarkdown(OFFERING_REPORT);
    expect(markdown).toContain(
      'Scope: processor activities of Hireloop ATS under its standard terms (Standard DPA v3).',
    );
    expect(markdown).not.toContain('## Controller activities');
  });

  it('keeps the anchor when the activity is renamed, so …#p1 still resolves', () => {
    const renamed = {
      ...OFFERING_REPORT,
      processorActivities: [
        { ...OFFERING_REPORT.processorActivities[0]!, name: 'Applicant pipeline' },
      ],
    };
    const markdown = renderReportMarkdown(renamed);
    expect(markdown).toContain('<a id="p1"></a>\n### P1 · Applicant pipeline\n');
  });

  it('escapes what would break a table or the markup', () => {
    const tricky = {
      ...OFFERING_REPORT,
      processorActivities: [
        {
          ...OFFERING_REPORT.processorActivities[0]!,
          name: 'Parsing *fast* <script>',
          subprocessors: [
            {
              ...OFFERING_REPORT.processorActivities[0]!.subprocessors[0]!,
              service: 'Hosting | storage',
            },
          ],
        },
      ],
    };
    const markdown = renderReportMarkdown(tricky);
    expect(markdown).toContain('### P1 · Parsing \\*fast\\* \\<script\\>');
    expect(markdown).toContain('| Hosting \\| storage |');
  });

  it('says so when the organisation is not recorded yet', () => {
    expect(renderReportMarkdown({ ...REPORT, organisation: null })).toContain(
      '_The organisation keeping this record (the self party) is not recorded yet._',
    );
  });

  it('renders the same report to the same text, twice', () => {
    expect(renderReportMarkdown(REPORT)).toBe(renderReportMarkdown(structuredClone(REPORT)));
  });
});

describe('humanDuration', () => {
  it.each([
    ['P7Y', '7 years'],
    ['P90D', '90 days'],
    ['P1Y6M', '1 year 6 months'],
    ['P2W', '2 weeks'],
    ['P1D', '1 day'],
    ['P0D', '0 days'],
  ])('%s reads as %s', (duration, words) => {
    expect(humanDuration(duration)).toBe(words);
  });
});
