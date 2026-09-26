/**
 * The Hireloop cast: every foundation record in the story (`ropa-story.md`,
 * cast and appendix), in dependency order.
 *
 * Two loaders read this. `demo:data` posts it over HTTP, stamped now.
 * `db:seed` replays it through the domain layer at the date each record enters
 * the story (`since`), together with the activities in `story.ts`, so the
 * history reads as the story tells it.
 */

export interface DemoRecord {
  readonly path: string;
  readonly slug: string;
  readonly body: Record<string, unknown>;
  /** When the record enters the story; the seed backdates it to this. */
  readonly since?: string;
}

/** The day Priya creates the record (Ch2); anything without a `since` is there from the start. */
export const STORY_START = '2026-02-10T08:00:00Z';

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
    ['identity', 'Identity & contact', 'none'],
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

const party = (
  slug: string,
  kind: string,
  legalName: string,
  country: string,
  extra: Record<string, unknown> = {},
  since?: string,
): DemoRecord => ({
  path: 'parties',
  slug,
  body: { slug, kind, legalName, country, ...extra },
  ...(since === undefined ? {} : { since }),
});

const parties: DemoRecord[] = [
  party('hireloop', 'self', 'Hireloop B.V.', 'NL', {
    dpoName: 'Priya Raman',
    dpoEmail: 'dpo@hireloop.example',
    changeNote: 'Set up the record',
  }),
  party('northwind', 'client', 'Northwind Logistics B.V.', 'NL'),
  party('fjord', 'client', 'Fjord Outdoor AS', 'NO'),
  // A prospect until it signs, and prospects are not in the record (Ch4).
  party('aurelia', 'client', 'Aurelia Bank S.A.', 'LU', {}, '2026-03-16T08:00:00Z'),
  party('render', 'vendor', 'Render Services, Inc.', 'US', {
    trustUrl: 'https://render.com/trust',
  }),
  party('mailcrest', 'vendor', 'Mailcrest Inc.', 'US', {
    subprocessorListUrl: 'https://mailcrest.example/subprocessors',
    dpaUrl: 'https://mailcrest.example/dpa',
  }),
  party('glitchlog', 'vendor', 'Glitchlog Ltd', 'US', {
    subprocessorListUrl: 'https://glitchlog.example/subprocessors',
  }),
  party('peoplehub', 'vendor', 'Peoplehub GmbH', 'DE'),
  // An independent controller: a recipient, never a subprocessor (Ch2).
  party('ledgerpay', 'other', 'Ledgerpay Ltd', 'IE'),
  party('scribe-ai', 'vendor', 'Scribe AI Inc.', 'US', {}, '2026-04-14T08:00:00Z'),
];

const terms = (
  slug: string,
  name: string,
  direction: 'outbound' | 'inbound',
  authorizationType: 'general' | 'specific',
  noticeDays: number,
  extra: Record<string, unknown> = {},
  since?: string,
): DemoRecord => ({
  path: 'agreement-terms',
  slug,
  body: { slug, name, direction, authorizationType, noticeDays, ...extra },
  ...(since === undefined ? {} : { since }),
});

const agreementTerms: DemoRecord[] = [
  terms('standard-dpa-v3', 'Standard DPA v3', 'outbound', 'general', 30, {
    changeNote: 'The terms 400 clients sign',
  }),
  terms(
    'aurelia-dpa',
    'Aurelia Bank DPA',
    'outbound',
    'specific',
    60,
    // EU-only processing (Ch4).
    { allowedRegions: ['EEA'], changeNote: 'Negotiated with Aurelia' },
    '2026-03-16T08:00:00Z',
  ),
  terms('render-dpa', 'Render DPA', 'inbound', 'general', 30),
  terms('mailcrest-dpa', 'Mailcrest DPA', 'inbound', 'general', 30),
  terms('glitchlog-dpa', 'Glitchlog DPA', 'inbound', 'general', 30),
  terms('peoplehub-dpa', 'Peoplehub DPA', 'inbound', 'general', 30),
  terms('scribe-ai-dpa', 'Scribe AI DPA', 'inbound', 'general', 30, {}, '2026-04-14T08:00:00Z'),
];

const offerings: DemoRecord[] = [
  {
    path: 'offerings',
    slug: 'ats',
    body: { slug: 'ats', name: 'Hireloop ATS', defaultTerms: 'standard-dpa-v3' },
  },
];

const system = (
  slug: string,
  name: string,
  kind: string,
  extra: Record<string, unknown> = {},
  since?: string,
): DemoRecord => ({
  path: 'systems',
  slug,
  body: {
    slug,
    name,
    kind,
    ...(kind === 'external_saas' ? {} : { region: 'frankfurt', hostingParty: 'render' }),
    ...extra,
  },
  ...(since === undefined ? {} : { since }),
});

/** What Architecture Snapshot would see on Render (cast), plus Peoplehub. */
const systems: DemoRecord[] = [
  system('hireloop-app', 'Recruiter app and candidate portal', 'render_web_service'),
  system('hireloop-api', 'Public API', 'render_web_service'),
  system('hireloop-db', 'Primary database', 'render_postgres'),
  system('hireloop-kv', 'Sessions', 'render_key_value'),
  system('retention-sweep', 'Retention sweep', 'render_cron'),
  system('marketing-site', 'Marketing site', 'render_static_site'),
  system('peoplehub-hr', 'Peoplehub HR', 'external_saas', { hostingParty: 'peoplehub' }),
  // Tomás ships it in April; the Snapshot finds it first (Ch5).
  system('cv-parser', 'CV parsing worker', 'render_worker', {}, '2026-04-06T08:00:00Z'),
];

/** Agreements have no slug, so they are matched on the pair they join. */
export interface DemoAgreement {
  readonly party: string;
  readonly terms: string;
  readonly offering?: string;
  readonly signedAt: string;
  readonly changeNote: string;
  readonly since?: string;
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
    party: 'fjord',
    terms: 'standard-dpa-v3',
    offering: 'ats',
    signedAt: '2026-02-05',
    changeNote: 'Fjord enrolled in the ATS',
  },
  {
    party: 'aurelia',
    terms: 'aurelia-dpa',
    offering: 'ats',
    signedAt: '2026-03-16',
    changeNote: 'Aurelia signed its own DPA (Ch4)',
    since: '2026-03-16T09:00:00Z',
  },
  ...['render', 'mailcrest', 'glitchlog', 'peoplehub'].map((vendor) => ({
    party: vendor,
    terms: `${vendor}-dpa`,
    signedAt: '2025-11-01',
    changeNote: `Our DPA with ${vendor}`,
  })),
  {
    party: 'scribe-ai',
    terms: 'scribe-ai-dpa',
    signedAt: '2026-04-10',
    changeNote: 'Our DPA with Scribe AI, zero retention (Ch5)',
    since: '2026-04-14T08:30:00Z',
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
