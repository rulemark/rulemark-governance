/**
 * The Hireloop story's activities (`ropa-story.md`, Ch2–Ch6 and the appendix),
 * as the timeline `db:seed` replays: what Priya created, approved and changed,
 * and when. References are by slug, as a caller would write them; the
 * foundation records they name are in `dataset.ts`.
 *
 * Every step carries its own change note. The seed uses it to tell whether an
 * edit has already been made, so running the seed twice changes nothing.
 */

type Body = Record<string, unknown>;

/** A new activity: drafted at `created`, approved at `activated`. */
export interface StoryActivity {
  readonly code: string;
  readonly created: string;
  readonly activated: string;
  readonly changeNote: string;
  readonly input: Body;
}

/** What an edit can look up: records by slug, agreements by the pair they join. */
export interface StoryLookup {
  readonly party: (slug: string) => string;
  readonly agreement: (party: string, terms: string) => string;
}

/**
 * A change to a live activity: given its current body (every nested row with
 * its id, from `inputFromSnapshot`), return the body to save.
 */
export interface StoryEdit {
  readonly code: string;
  readonly at: string;
  readonly changeNote: string;
  readonly edit: (current: Body, lookup: StoryLookup) => Body;
}

const engagement = (
  party: string,
  role: string,
  serviceDescription: string,
  processingCountries: string[],
  dataCategories: string[],
  extra: Body = {},
): Body => ({ party, role, serviceDescription, processingCountries, dataCategories, ...extra });

const dpf = { destinationCountry: 'US', mechanism: 'dpf' };
const sccs = { destinationCountry: 'US', mechanism: 'sccs' };

// --- Chapter 2: Hireloop as controller (February 2026) ---

const C1: StoryActivity = {
  code: 'C1',
  created: '2026-02-10T10:00:00Z',
  activated: '2026-02-10T15:00:00Z',
  changeNote: 'Staff administration, rebuilt from the spreadsheet',
  input: {
    role: 'controller',
    name: 'Hireloop staff administration',
    description:
      'Contracts, payroll and sick leave for Hireloop’s own employees, kept in Peoplehub.',
    owner: 'Priya Raman',
    purposes: ['Administer employment contracts', 'Run payroll', 'Manage sick leave'],
    lawfulBases: ['6(1)(b)', '6(1)(c)'],
    // Sick-leave records are health data (Ch2).
    specialConditions: ['9(2)(b)'],
    subjectCategories: ['employees'],
    dataCategories: ['identity', 'payroll', 'health'],
    systems: ['peoplehub-hr'],
    securityMeasures: ['sso-for-staff', 'rbac'],
    retentionRules: [
      {
        dataCategory: 'health',
        retentionPeriod: 'P2Y',
        triggerEvent: 'after the sick-leave period ends',
      },
      {
        dataCategory: 'payroll',
        retentionPeriod: 'P7Y',
        triggerEvent: 'after the end of the tax year',
        legalRef: 'Dutch tax law',
      },
      { retentionPeriod: 'P2Y', triggerEvent: 'after employment ends' },
    ],
    engagements: [
      engagement('peoplehub', 'processor', 'HR system', ['DE'], ['identity', 'payroll', 'health']),
    ],
  },
};

const C2: StoryActivity = {
  code: 'C2',
  created: '2026-02-10T10:10:00Z',
  activated: '2026-02-10T15:05:00Z',
  changeNote: 'Customer accounts and billing',
  input: {
    role: 'controller',
    name: 'Customer accounts & billing',
    description: 'Recruiter logins and billing contacts of Hireloop’s customers.',
    owner: 'Priya Raman',
    purposes: ['Provide contracted service accounts', 'Invoice and collect payment'],
    lawfulBases: ['6(1)(b)', '6(1)(c)'],
    subjectCategories: ['client-users'],
    dataCategories: ['identity', 'account', 'billing'],
    systems: ['hireloop-app', 'hireloop-db', 'hireloop-kv'],
    securityMeasures: ['encryption-at-rest', 'sso-for-staff', 'rbac', 'audit-logging'],
    retentionRules: [
      { dataCategory: 'account', retentionPeriod: 'P90D', triggerEvent: 'after contract end' },
      {
        dataCategory: 'billing',
        retentionPeriod: 'P7Y',
        triggerEvent: 'after invoice date',
        legalRef: 'Dutch tax law',
      },
    ],
    engagements: [
      engagement('render', 'processor', 'Hosting', ['DE'], ['identity', 'account', 'billing']),
      engagement('mailcrest', 'processor', 'Transactional email', ['US'], ['identity'], {
        transfers: [dpf],
      }),
      // An independent controller: a recipient, not a processor (Ch2).
      engagement('ledgerpay', 'recipient', 'Payment processing', ['IE'], ['billing']),
    ],
  },
};

const C3: StoryActivity = {
  code: 'C3',
  created: '2026-02-10T10:20:00Z',
  activated: '2026-02-10T15:10:00Z',
  changeNote: 'Sales and marketing to prospective customers',
  input: {
    role: 'controller',
    name: 'Hireloop sales & marketing (prospective customers)',
    description:
      'HR managers at companies that might buy the ATS: demo requests and the newsletter.',
    owner: 'Ines Duarte',
    purposes: ['Answer demo requests', 'Send the newsletter to subscribers'],
    lawfulBases: ['6(1)(a)', '6(1)(f)'],
    subjectCategories: ['leads'],
    dataCategories: ['identity', 'marketing'],
    systems: ['marketing-site'],
    securityMeasures: ['encryption-at-rest', 'rbac'],
    retentionRules: [{ retentionPeriod: 'P2Y', triggerEvent: 'after the last contact' }],
    engagements: [
      engagement('render', 'processor', 'Hosting', ['DE'], ['identity', 'marketing']),
      engagement(
        'mailcrest',
        'processor',
        'Newsletter and demo emails',
        ['US'],
        ['identity', 'marketing'],
        {
          transfers: [dpf],
        },
      ),
    ],
  },
};

const C4: StoryActivity = {
  code: 'C4',
  created: '2026-02-10T10:30:00Z',
  activated: '2026-02-10T15:15:00Z',
  changeNote: 'Service reliability monitoring, a grey zone decided as controller',
  input: {
    role: 'controller',
    name: 'Service reliability monitoring',
    description: 'Error tracking and telemetry for Hireloop’s own service.',
    owner: 'Tomás Herrera',
    roleRationale:
      'Error reports sometimes carry candidate emails in stack traces. Hireloop processes them to keep its own service secure and working, which is its own purpose, so it acts as controller. Scrubbing personal data from error payloads is on the backlog.',
    purposes: ['Detect and fix faults in the service', 'Keep the service secure'],
    lawfulBases: ['6(1)(f)'],
    subjectCategories: ['client-users', 'candidates'],
    dataCategories: ['telemetry', 'identity'],
    systems: ['hireloop-app', 'hireloop-api'],
    securityMeasures: ['encryption-at-rest', 'rbac', 'audit-logging'],
    retentionRules: [{ retentionPeriod: 'P90D', triggerEvent: 'after collection' }],
    engagements: [
      engagement('render', 'processor', 'Hosting', ['DE'], ['telemetry', 'identity']),
      engagement('glitchlog', 'processor', 'Error tracking', ['US'], ['telemetry', 'identity'], {
        transfers: [sccs],
      }),
    ],
  },
};

// --- Chapter 3: Hireloop as processor (February 2026) ---

const P1: StoryActivity = {
  code: 'P1',
  created: '2026-02-12T10:00:00Z',
  activated: '2026-02-12T15:00:00Z',
  changeNote: 'The ATS, for every client on the standard terms',
  input: {
    role: 'processor',
    name: 'Candidate application management',
    owner: 'Priya Raman',
    offering: 'ats',
    clientCoverage: 'all_enrolled',
    processingCategories: [
      'hosting',
      'storage',
      'workflow',
      'candidate notifications',
      'retention-deletion',
    ],
    subjectCategories: ['candidates'],
    dataCategories: ['identity', 'cv', 'assessment'],
    systems: ['hireloop-app', 'hireloop-api', 'hireloop-db', 'retention-sweep'],
    securityMeasures: ['encryption-at-rest', 'tenant-isolation', 'rbac', 'audit-logging'],
    engagements: [
      engagement('render', 'subprocessor', 'Hosting', ['DE'], ['identity', 'cv', 'assessment']),
      engagement('mailcrest', 'subprocessor', 'Candidate notifications', ['US'], ['identity'], {
        transfers: [dpf],
      }),
      engagement('glitchlog', 'subprocessor', 'Error tracking', ['US'], ['identity'], {
        transfers: [sccs],
      }),
    ],
  },
};

// --- Chapter 4: signing Aurelia (2026-03-16) ---

const byParty = (lookup: StoryLookup, slug: string) => (row: Body) =>
  row['party'] === lookup.party(slug);

const P1_FOR_AURELIA: StoryEdit = {
  code: 'P1',
  at: '2026-03-16T10:00:00Z',
  changeNote: 'Aurelia signed: EU region for her candidate emails, no Glitchlog for her (Ch4)',
  edit: (current, lookup) => {
    const aureliaDpa = lookup.agreement('aurelia', 'aurelia-dpa');
    const excludeAurelia = {
      mode: 'exclude',
      clients: [
        { client: 'aurelia', reason: 'EU-only processing (Aurelia DPA)', agreement: aureliaDpa },
      ],
    };
    const engagements = (current['engagements'] as Body[]).map((row) => {
      if (byParty(lookup, 'mailcrest')(row)) {
        return {
          ...row,
          serviceDescription: 'Candidate notifications (US region)',
          clientScope: excludeAurelia,
        };
      }
      if (byParty(lookup, 'glitchlog')(row)) return { ...row, clientScope: excludeAurelia };
      return row;
    });
    return {
      ...current,
      engagements: [
        ...engagements,
        engagement(
          'mailcrest',
          'subprocessor',
          'Candidate notifications (EU region)',
          ['IE'],
          ['identity'],
          {
            clientScope: {
              mode: 'include',
              clients: [
                {
                  client: 'aurelia',
                  reason: 'EU data region (Aurelia DPA)',
                  agreement: aureliaDpa,
                },
              ],
            },
          },
        ),
      ],
    };
  },
};

const P2: StoryActivity = {
  code: 'P2',
  created: '2026-03-16T11:00:00Z',
  activated: '2026-03-16T15:00:00Z',
  changeNote: 'The Diversity & accommodations module, enabled by Aurelia (Ch4)',
  input: {
    role: 'processor',
    name: 'Diversity & accommodations module',
    description:
      'Ethnicity and accommodation requests, only for clients who enable the module. The Art. 9 condition is the client’s to establish.',
    owner: 'Priya Raman',
    offering: 'ats',
    clientCoverage: 'opt_in',
    clientScope: {
      mode: 'include',
      clients: [
        { client: 'aurelia', reason: 'Client enabled the module', startedAt: '2026-03-16' },
      ],
    },
    processingCategories: ['storage', 'reporting'],
    subjectCategories: ['candidates'],
    dataCategories: ['diversity', 'health'],
    systems: ['hireloop-app', 'hireloop-db'],
    securityMeasures: ['encryption-at-rest', 'tenant-isolation', 'rbac'],
    engagements: [engagement('render', 'subprocessor', 'Hosting', ['DE'], ['diversity', 'health'])],
  },
};

// --- Chapter 5: Jonas wants AI (2026-04-14) ---

const P3: StoryActivity = {
  code: 'P3',
  created: '2026-04-14T10:00:00Z',
  activated: '2026-04-14T15:00:00Z',
  changeNote: 'AI CV parsing, with Scribe AI; Aurelia objected, so not for her (Ch5)',
  input: {
    role: 'processor',
    name: 'CV parsing',
    owner: 'Priya Raman',
    offering: 'ats',
    clientCoverage: 'all_enrolled',
    clientScope: {
      mode: 'exclude',
      clients: [
        {
          client: 'aurelia',
          reason: 'Client objected (Aurelia DPA, specific authorization)',
          startedAt: '2026-04-14',
        },
      ],
    },
    processingCategories: ['automated CV parsing'],
    subjectCategories: ['candidates'],
    dataCategories: ['cv', 'identity'],
    systems: ['cv-parser'],
    securityMeasures: ['encryption-at-rest', 'tenant-isolation'],
    dpiaSupportRef: 'DPIA support pack: CV parsing (2026-04-02)',
    engagements: [
      engagement('render', 'subprocessor', 'Hosting', ['DE'], ['cv', 'identity']),
      engagement(
        'scribe-ai',
        'subprocessor',
        'LLM-based CV parsing, zero retention',
        ['US'],
        ['cv'],
        {
          transfers: [sccs],
        },
      ),
    ],
  },
};

// --- Chapter 6: a vendor changes its list (effective 2026-07-03) ---

/**
 * Helpdesk Partners in India can open message content in every Mailcrest
 * region, the EU one included: an onward transfer on every Mailcrest
 * engagement. Recorded on the EU region too, which is what makes `/coverage`
 * flag Aurelia's EU-only clause (Ch6).
 */
const helpdeskPartners = (code: string): StoryEdit => ({
  code,
  at: '2026-07-03T09:00:00Z',
  changeNote: 'Mailcrest added Helpdesk Partners (India) in every region (Ch6)',
  edit: (current, lookup) => ({
    ...current,
    engagements: (current['engagements'] as Body[]).map((row) =>
      byParty(lookup, 'mailcrest')(row)
        ? {
            ...row,
            transfers: [
              ...((row['transfers'] as Body[] | undefined) ?? []),
              {
                destinationCountry: 'IN',
                mechanism: 'sccs',
                onwardVia: 'Helpdesk Partners Pvt Ltd',
                documentRef: 'Mailcrest DPA',
              },
            ],
          }
        : row,
    ),
  }),
});

export const STORY_ACTIVITIES: readonly StoryActivity[] = [C1, C2, C3, C4, P1, P2, P3];

export const STORY_EDITS: readonly StoryEdit[] = [
  P1_FOR_AURELIA,
  helpdeskPartners('C2'),
  helpdeskPartners('C3'),
  helpdeskPartners('P1'),
];
