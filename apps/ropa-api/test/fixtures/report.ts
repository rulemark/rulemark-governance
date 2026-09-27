import type { ReportResponse } from '@rulemark/ropa-schemas';

/**
 * A small Art. 30 report, as `buildReport` answers it: one controller activity
 * and two processor activities of the ATS, one of them an opt-in module. The
 * Markdown and CSV renderings are both tested against it.
 */

export const id = (n: number) => `0199c3a1-8f2e-7c4d-b8e1-${String(n).padStart(12, '0')}`;
export const ref = (n: number, slug: string, name: string) => ({ id: id(n), slug, name });

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

export const REPORT: ReportResponse = {
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

export const OFFERING_REPORT: ReportResponse = {
  ...REPORT,
  scope: { view: 'processor', offering: ats, client: null, terms: standardTerms },
  controllerActivities: [],
};
