/**
 * The Hireloop cast, as far as build step 1 reaches (`ropa-story.md`).
 *
 * Foundation records only: activities, engagements and the client scoping that
 * make the story interesting arrive in step 2. What is here is enough to make
 * lists, filters, references and revisions worth looking at.
 */

export interface DemoRecord {
  readonly path: string;
  readonly slug: string;
  readonly body: Record<string, unknown>;
}

const taxonomies: DemoRecord[] = [
  ...[
    ['candidates', 'Candidates', 'People applying for roles through a client'],
    ['client-users', 'Client users', 'Recruiters and hiring managers at our clients'],
    ['employees', 'Employees', 'Hireloop’s own staff'],
    ['leads', 'Leads', 'Prospective clients'],
  ].map(([slug, name, description]) => ({
    path: 'taxonomy/subject-categories',
    slug: slug!,
    body: { slug, name, description },
  })),

  ...[
    ['identity', 'Identity', 'none'],
    ['cv', 'CV and work history', 'none'],
    ['assessment', 'Assessment results', 'none'],
    ['diversity', 'Diversity data', 'art9'],
    ['health', 'Health data', 'art9'],
    ['account', 'Account data', 'none'],
    ['billing', 'Billing data', 'none'],
    ['telemetry', 'Telemetry', 'none'],
    ['payroll', 'Payroll data', 'none'],
    ['marketing', 'Marketing data', 'none'],
  ].map(([slug, name, special]) => ({
    path: 'taxonomy/data-categories',
    slug: slug!,
    body: { slug, name, special },
  })),

  ...[
    ['encryption-at-rest', 'Encryption at rest'],
    ['tenant-isolation', 'Tenant isolation'],
    ['rbac', 'Role-based access control'],
    ['sso-for-staff', 'SSO for staff'],
    ['audit-logging', 'Audit logging'],
  ].map(([slug, name]) => ({
    path: 'taxonomy/security-measures',
    slug: slug!,
    body: { slug, name },
  })),
];

const parties: DemoRecord[] = [
  {
    path: 'parties',
    slug: 'hireloop',
    body: {
      slug: 'hireloop',
      kind: 'self',
      legalName: 'Hireloop B.V.',
      country: 'NL',
      dpoName: 'Priya Raman',
      dpoEmail: 'dpo@hireloop.example',
      changeNote: 'Set up the record',
    },
  },
  {
    path: 'parties',
    slug: 'aurelia',
    body: { slug: 'aurelia', kind: 'client', legalName: 'Aurelia Health N.V.', country: 'NL' },
  },
  {
    path: 'parties',
    slug: 'northwind',
    body: { slug: 'northwind', kind: 'client', legalName: 'Northwind GmbH', country: 'DE' },
  },
  {
    path: 'parties',
    slug: 'mailcrest',
    body: {
      slug: 'mailcrest',
      kind: 'vendor',
      legalName: 'Mailcrest Inc.',
      country: 'US',
      subprocessorListUrl: 'https://mailcrest.example/subprocessors',
      dpaUrl: 'https://mailcrest.example/dpa',
    },
  },
  {
    path: 'parties',
    slug: 'glitchlog',
    body: {
      slug: 'glitchlog',
      kind: 'vendor',
      legalName: 'Glitchlog Inc.',
      country: 'US',
      subprocessorListUrl: 'https://glitchlog.example/subprocessors',
    },
  },
  {
    path: 'parties',
    slug: 'scribe-ai',
    body: { slug: 'scribe-ai', kind: 'vendor', legalName: 'Scribe AI Ltd', country: 'GB' },
  },
  {
    path: 'parties',
    slug: 'peoplehub',
    body: { slug: 'peoplehub', kind: 'vendor', legalName: 'Peoplehub B.V.', country: 'NL' },
  },
  {
    path: 'parties',
    slug: 'ledgerpay',
    body: { slug: 'ledgerpay', kind: 'other', legalName: 'Ledgerpay B.V.', country: 'NL' },
  },
  {
    path: 'parties',
    slug: 'render',
    body: {
      slug: 'render',
      kind: 'vendor',
      legalName: 'Render Services, Inc.',
      country: 'US',
      trustUrl: 'https://render.com/trust',
    },
  },
];

const agreementTerms: DemoRecord[] = [
  {
    path: 'agreement-terms',
    slug: 'standard-dpa-v3',
    body: {
      slug: 'standard-dpa-v3',
      name: 'Standard DPA v3',
      direction: 'outbound',
      authorizationType: 'general',
      noticeDays: 30,
      changeNote: 'The terms 400 clients sign',
    },
  },
  {
    path: 'agreement-terms',
    slug: 'aurelia-dpa',
    body: {
      slug: 'aurelia-dpa',
      name: 'Aurelia DPA',
      direction: 'outbound',
      authorizationType: 'specific',
      noticeDays: 60,
      // Aurelia's own terms restrict processing to the EEA (Ch4).
      allowedRegions: ['EEA'],
      changeNote: 'Negotiated with Aurelia',
    },
  },
  {
    path: 'agreement-terms',
    slug: 'mailcrest-dpa',
    body: {
      slug: 'mailcrest-dpa',
      name: 'Mailcrest DPA',
      direction: 'inbound',
      authorizationType: 'general',
      noticeDays: 30,
    },
  },
];

const offerings: DemoRecord[] = [
  {
    path: 'offerings',
    slug: 'ats',
    body: { slug: 'ats', name: 'Hireloop ATS', defaultTerms: 'standard-dpa-v3' },
  },
];

const systems: DemoRecord[] = [
  {
    path: 'systems',
    slug: 'hireloop-api',
    body: {
      slug: 'hireloop-api',
      name: 'ATS API',
      kind: 'render_web_service',
      region: 'frankfurt',
      hostingParty: 'render',
    },
  },
  {
    path: 'systems',
    slug: 'hireloop-db',
    body: {
      slug: 'hireloop-db',
      name: 'Primary database',
      kind: 'render_postgres',
      region: 'frankfurt',
      hostingParty: 'render',
    },
  },
  {
    path: 'systems',
    slug: 'cv-parser',
    body: {
      slug: 'cv-parser',
      name: 'CV parsing worker',
      kind: 'render_worker',
      region: 'frankfurt',
      hostingParty: 'render',
    },
  },
  {
    path: 'systems',
    slug: 'peoplehub-hr',
    body: {
      slug: 'peoplehub-hr',
      name: 'Peoplehub HR',
      kind: 'external_saas',
      hostingParty: 'peoplehub',
    },
  },
];

/** Agreements have no slug, so they are matched on the pair they join. */
export interface DemoAgreement {
  readonly party: string;
  readonly terms: string;
  readonly offering?: string;
  readonly signedAt: string;
  readonly changeNote: string;
}

export const DEMO_AGREEMENTS: readonly DemoAgreement[] = [
  {
    party: 'northwind',
    terms: 'standard-dpa-v3',
    offering: 'ats',
    signedAt: '2026-02-02',
    changeNote: 'Northwind enrolled in the ATS',
  },
  {
    party: 'aurelia',
    terms: 'aurelia-dpa',
    offering: 'ats',
    signedAt: '2026-03-16',
    changeNote: 'Aurelia signed its own DPA (Ch4)',
  },
  {
    party: 'mailcrest',
    terms: 'mailcrest-dpa',
    signedAt: '2026-01-10',
    changeNote: 'Our DPA with Mailcrest',
  },
];

/** Order matters: a record cannot reference one that does not exist yet. */
export const DEMO_RECORDS: readonly DemoRecord[] = [
  ...taxonomies,
  ...parties,
  ...agreementTerms,
  ...offerings,
  ...systems,
];
