import type { ReportResponse } from '@rulemark/ropa-schemas';
import { describe, expect, it } from 'vitest';

import { humanDuration, renderReportMarkdown } from './markdown.js';

/**
 * The Markdown report (`ropa-api.md` §5.1) feeds the architecture document, so
 * it must be stable: the same record renders to the same text, and a diff
 * between two exports shows what changed in the record and nothing else. The
 * golden test below fixes the output exactly.
 */

const id = (n: number) => `0199c3a1-8f2e-7c4d-b8e1-${String(n).padStart(12, '0')}`;
const ref = (n: number, slug: string, name: string) => ({ id: id(n), slug, name });

const standardTerms = {
  ...ref(1, 'standard-dpa-v3', 'Standard DPA v3'),
  authorizationType: 'general' as const,
  noticeDays: 30,
};
const ats = ref(2, 'ats', 'Hireloop ATS');
const render = ref(3, 'render', 'Render Services, Inc.');
const mailcrest = ref(4, 'mailcrest', 'Mailcrest Inc.');
const candidates = ref(5, 'candidates', 'Candidates');
const identity = { ...ref(6, 'identity', 'Identity & contact'), special: 'none' as const };
const health = { ...ref(7, 'health', 'Health data'), special: 'art9' as const };
const billing = { ...ref(8, 'billing', 'Billing data'), special: 'none' as const };
const encryption = ref(9, 'encryption-at-rest', 'Encryption at rest');
const ledgerpay = ref(10, 'ledgerpay', 'Ledgerpay Ltd');

const activityBase = {
  description: null,
  owner: 'Priya Raman',
  startedAt: '2026-02-10',
  reviewDueAt: null,
  subjectCategories: [candidates],
  securityMeasures: [encryption],
};

const REPORT: ReportResponse = {
  generatedAt: '2026-09-26T10:00:00.000Z',
  asOf: null,
  scope: { view: 'all', offering: null, client: null, terms: null },
  organisation: {
    party: ref(11, 'hireloop', 'Hireloop B.V.'),
    legalName: 'Hireloop B.V.',
    country: 'NL',
    contactName: null,
    contactEmail: null,
    dpoName: 'Priya Raman',
    dpoEmail: 'dpo@hireloop.example',
  },
  controllerActivities: [
    {
      ...activityBase,
      id: id(20),
      code: 'C2',
      name: 'Customer accounts & billing',
      description: 'Accounts for client users, and invoicing.',
      reviewDueAt: '2027-02-10',
      dataCategories: [billing, health],
      purposes: ['Provide contracted service accounts', 'Invoice and collect payment'],
      lawfulBases: ['6(1)(b)', '6(1)(c)'],
      specialConditions: ['9(2)(b)'],
      recipients: [
        {
          party: ledgerpay,
          role: 'recipient',
          service: 'Payment processing',
          processingCountries: ['IE'],
          transfers: [],
          dataCategories: [billing],
        },
      ],
      retentionRules: [
        {
          dataCategory: billing,
          retentionPeriod: 'P7Y',
          triggerEvent: 'after invoice date',
          legalRef: 'Dutch tax law',
        },
        {
          dataCategory: null,
          retentionPeriod: 'P90D',
          triggerEvent: 'after contract end',
          legalRef: null,
        },
      ],
      dpiaRequired: false,
      dpiaRef: null,
    },
  ],
  processorActivities: [
    {
      ...activityBase,
      id: id(21),
      code: 'P1',
      name: 'Candidate application management',
      dataCategories: [identity],
      offering: ats,
      clientCoverage: 'all_enrolled',
      optionalModule: false,
      controllers: { kind: 'standard', terms: standardTerms },
      processingCategories: ['hosting', 'candidate notifications'],
      subprocessors: [
        {
          party: render,
          role: 'subprocessor',
          service: 'Hosting',
          processingCountries: ['DE'],
          transfers: [],
          dataCategories: [identity],
        },
        {
          party: mailcrest,
          role: 'subprocessor',
          service: 'Candidate notifications (US region)',
          processingCountries: ['US'],
          transfers: [{ destinationCountry: 'US', mechanism: 'dpf', onwardVia: null }],
          dataCategories: [identity],
        },
      ],
      dpiaSupportRef: null,
    },
    {
      ...activityBase,
      id: id(22),
      code: 'P2',
      name: 'Diversity & accommodations module',
      startedAt: '2026-03-16',
      dataCategories: [health],
      offering: ats,
      clientCoverage: 'opt_in',
      optionalModule: true,
      controllers: { kind: 'standard', terms: standardTerms },
      processingCategories: ['storage'],
      subprocessors: [
        {
          party: render,
          role: 'subprocessor',
          service: 'Hosting',
          processingCountries: ['DE'],
          transfers: [],
          dataCategories: [health],
        },
      ],
      dpiaSupportRef: 'DPIA-SUPPORT-DIVERSITY',
    },
  ],
  subprocessors: {
    generatedAt: '2026-09-26T10:00:00.000Z',
    asOf: null,
    scope: { offering: ats, client: null, terms: standardTerms },
    subprocessors: [
      {
        party: render,
        services: ['Hosting'],
        processingCountries: ['DE'],
        transfers: [],
        activities: [{ id: id(21), code: 'P1', name: 'Candidate application management' }],
      },
      {
        party: mailcrest,
        services: ['Candidate notifications (US region)'],
        processingCountries: ['US'],
        transfers: [{ destinationCountry: 'US', mechanism: 'dpf', onwardVia: null }],
        activities: [{ id: id(21), code: 'P1', name: 'Candidate application management' }],
      },
    ],
    optionalModules: [
      {
        activity: { id: id(22), code: 'P2', name: 'Diversity & accommodations module' },
        subprocessors: [
          {
            party: render,
            services: ['Hosting'],
            processingCountries: ['DE'],
            transfers: [],
            activities: [{ id: id(22), code: 'P2', name: 'Diversity & accommodations module' }],
          },
        ],
      },
    ],
  },
};

const OFFERING_REPORT: ReportResponse = {
  ...REPORT,
  scope: { view: 'processor', offering: ats, client: null, terms: standardTerms },
  controllerActivities: [],
};

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
