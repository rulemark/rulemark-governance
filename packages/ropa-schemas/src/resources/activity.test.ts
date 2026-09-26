import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import {
  ActivateInput,
  Activity,
  ActivityInput,
  ProcessorActivityInput,
  ROLE_FIELDS,
  RetireInput,
  describeRoleRules,
  inputFromActivity,
  validateActivityShape,
  type RoleField,
} from './index.js';

const UUID = '0199c3a1-8f2e-7c4d-b8e1-2f3a4b5c6d7e';
const AGREEMENT = '0199c3a1-8f2e-7c4d-b8e1-9c41aaaa0001';

/** P1 exactly as `ropa-api.md` §3.2 creates it (Ch3). */
const P1 = {
  changeNote: 'Initial processor record for the ATS',
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
    {
      party: 'render',
      role: 'subprocessor',
      serviceDescription: 'Hosting',
      processingCountries: ['DE'],
      dataCategories: ['identity', 'cv', 'assessment'],
    },
    {
      party: 'mailcrest',
      role: 'subprocessor',
      serviceDescription: 'Candidate notifications',
      processingCountries: ['US'],
      dataCategories: ['identity'],
      transfers: [{ destinationCountry: 'US', mechanism: 'dpf' }],
    },
    {
      party: 'glitchlog',
      role: 'subprocessor',
      serviceDescription: 'Error tracking',
      processingCountries: ['US'],
      dataCategories: ['identity'],
      transfers: [{ destinationCountry: 'US', mechanism: 'sccs' }],
    },
  ],
};

/** C2 (Ch2) as a caller would send it. */
const C2 = {
  role: 'controller',
  name: 'Customer accounts & billing',
  owner: 'Priya Raman',
  purposes: ['Provide contracted service accounts', 'Invoice and collect payment'],
  lawfulBases: ['6(1)(b)', '6(1)(c)'],
  subjectCategories: ['client-users'],
  dataCategories: ['identity', 'account', 'billing'],
  systems: ['hireloop-app'],
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
    {
      party: 'ledgerpay',
      role: 'recipient',
      serviceDescription: 'Payment processing (independent controller)',
      processingCountries: ['IE'],
      dataCategories: ['billing'],
    },
  ],
  startedAt: '2026-02-10',
  reviewDueAt: '2027-02-10',
};

/** A valid value for every role-dependent field, to test the rule table against the schema. */
const SAMPLE: Readonly<Record<RoleField, unknown>> = {
  purposes: ['Recruitment'],
  lawfulBases: ['6(1)(f)'],
  specialConditions: ['9(2)(b)'],
  retentionRules: [{ retentionPeriod: 'P90D', triggerEvent: 'after contract end' }],
  dpiaRequired: true,
  dpiaRef: 'DPIA-2026-01',
  offering: 'ats',
  clientCoverage: 'all_enrolled',
  processingCategories: ['hosting'],
  clientScope: { mode: 'exclude', clients: [{ client: 'aurelia', startedAt: '2026-04-14' }] },
  dpiaSupportRef: 'DPIA-SUPPORT-ATS',
};

function errorsFor(input: unknown) {
  return validateActivityShape(input);
}

function codesAt(input: unknown, path: string): string[] {
  return errorsFor(input)
    .filter((error) => error.path === path)
    .map((error) => error.code);
}

describe('ActivityInput', () => {
  it('accepts P1 exactly as the API design creates it (§3.2)', () => {
    expect(errorsFor(P1)).toEqual([]);
  });

  it('accepts C2, a controller with retention rules and a recipient (Ch2)', () => {
    expect(errorsFor(C2)).toEqual([]);
  });

  it('narrows on role, so each branch has only its own fields', () => {
    const parsed = ActivityInput.parse(P1);
    if (parsed.role !== 'processor') throw new Error('expected a processor');
    expectTypeOf(parsed.offering).toEqualTypeOf<string | undefined>();
    expectTypeOf(parsed.purposes).toEqualTypeOf<undefined>();
    expect(parsed.offering).toBe('ats');
  });

  it('fills the lists a caller leaves out, so a PUT that omits one empties it (§1.4)', () => {
    const parsed = ActivityInput.parse({ role: 'controller', name: 'Draft', owner: 'Priya' });
    if (parsed.role !== 'controller') throw new Error('expected a controller');
    expect(parsed.purposes).toEqual([]);
    expect(parsed.retentionRules).toEqual([]);
    expect(parsed.engagements).toEqual([]);
    expect(parsed.dataCategories).toEqual([]);
    expect(parsed.dpiaRequired).toBe(false);
  });

  it('lets a draft be incomplete: required-by-role waits for activation (§1.5)', () => {
    expect(errorsFor({ role: 'controller', name: 'Draft', owner: 'Priya' })).toEqual([]);
    expect(errorsFor({ role: 'processor', name: 'Draft', owner: 'Priya' })).toEqual([]);
  });

  it('still requires what every activity needs, whatever its status', () => {
    const paths = errorsFor({ role: 'controller' }).map((error) => error.path);
    expect(paths).toContain('/name');
    expect(paths).toContain('/owner');
  });

  describe('forbidden by role (DM §5)', () => {
    it('reports purposes on a processor alongside a structural error, in one response', () => {
      const errors = errorsFor({ ...P1, name: '', purposes: ['Recruitment'] });
      expect(errors).toContainEqual(expect.objectContaining({ path: '/name' }));
      expect(errors).toContainEqual({
        path: '/purposes',
        code: 'forbidden_for_role',
        message: 'Processor activities cannot have purposes (Art. 30(2))',
      });
    });

    it('rejects a forbidden field even when it is empty: absent is the only allowed value', () => {
      expect(codesAt({ ...P1, purposes: [] }, '/purposes')).toEqual(['forbidden_for_role']);
      expect(codesAt({ ...C2, offering: null }, '/offering')).toEqual(['forbidden_for_role']);
    });

    for (const role of ['controller', 'processor'] as const) {
      const rules = describeRoleRules(role);
      const base = role === 'controller' ? C2 : P1;

      for (const field of ROLE_FIELDS) {
        if (rules.fields[field].rule === 'forbidden') {
          it(`rejects ${field} on a ${role}, at /${field}`, () => {
            expect(codesAt({ ...base, [field]: SAMPLE[field] }, `/${field}`)).toEqual([
              'forbidden_for_role',
            ]);
          });
        } else {
          it(`accepts ${field} on a ${role}`, () => {
            const { clientCoverage: _coverage, ...withoutCoverage } = P1;
            const input = field === 'clientScope' ? withoutCoverage : base;
            expect(errorsFor({ ...input, [field]: SAMPLE[field] })).toEqual([]);
          });
        }
      }
    }
  });

  describe('engagement roles by activity role (DM §5)', () => {
    const engagement = (role: string) => ({
      party: 'mailcrest',
      role,
      serviceDescription: 'Notifications',
      processingCountries: ['US'],
    });

    it('allows processor and recipient engagements on a controller', () => {
      expect(errorsFor({ ...C2, engagements: [engagement('processor')] })).toEqual([]);
      expect(errorsFor({ ...C2, engagements: [engagement('recipient')] })).toEqual([]);
    });

    it('allows only subprocessor engagements on a processor, like the §1.7 example', () => {
      const errors = errorsFor({
        ...P1,
        engagements: [engagement('subprocessor'), engagement('processor')],
      });
      expect(errors).toEqual([
        {
          path: '/engagements/1/role',
          code: 'role_not_allowed',
          message: 'Processor activities only allow subprocessor engagements',
        },
      ]);
    });

    it('rejects a subprocessor engagement on a controller', () => {
      expect(
        codesAt({ ...C2, engagements: [engagement('subprocessor')] }, '/engagements/0/role'),
      ).toEqual(['role_not_allowed']);
    });

    it('rejects joint_controller engagements as not yet supported (DM §10, Q5)', () => {
      expect(
        codesAt({ ...C2, engagements: [engagement('joint_controller')] }, '/engagements/0/role'),
      ).toEqual(['not_yet_supported']);
    });

    it('rejects a role that does not exist at all', () => {
      expect(codesAt({ ...C2, engagements: [engagement('owner')] }, '/engagements/0/role')).toEqual(
        ['invalid_value'],
      );
    });

    it('needs at least one processing country: where the data is, not where the vendor is', () => {
      const { processingCountries: _countries, ...withoutCountries } = engagement('recipient');
      expect(
        codesAt({ ...C2, engagements: [withoutCountries] }, '/engagements/0/processingCountries'),
      ).not.toEqual([]);
      expect(
        codesAt(
          { ...C2, engagements: [{ ...withoutCountries, processingCountries: [] }] },
          '/engagements/0/processingCountries',
        ),
      ).not.toEqual([]);
    });

    it('keeps client scope to engagements on processor activities (DM §3.8)', () => {
      const scoped = {
        ...engagement('processor'),
        clientScope: { mode: 'exclude', clients: [{ client: 'aurelia', reason: 'EU only' }] },
      };
      expect(codesAt({ ...C2, engagements: [scoped] }, '/engagements/0/clientScope')).toEqual([
        'forbidden_for_role',
      ]);
    });
  });

  describe('client scope (DM §3.8)', () => {
    const scope = (mode: string) => ({
      mode,
      clients: [
        { client: 'aurelia', reason: 'Client enabled the module', startedAt: '2026-03-16' },
      ],
    });

    it('takes include rows on an opt_in activity and exclude rows on an all_enrolled one', () => {
      expect(errorsFor({ ...P1, clientCoverage: 'opt_in', clientScope: scope('include') })).toEqual(
        [],
      );
      expect(
        errorsFor({ ...P1, clientCoverage: 'all_enrolled', clientScope: scope('exclude') }),
      ).toEqual([]);
    });

    it('rejects a mode that contradicts the coverage, at the mode', () => {
      expect(
        errorsFor({ ...P1, clientCoverage: 'opt_in', clientScope: scope('exclude') }),
      ).toContainEqual(expect.objectContaining({ path: '/clientScope/mode' }));
      expect(
        errorsFor({ ...P1, clientCoverage: 'all_enrolled', clientScope: scope('include') }),
      ).toContainEqual(expect.objectContaining({ path: '/clientScope/mode' }));
    });

    it('treats null as no scope, as the API design spells it', () => {
      expect(errorsFor({ ...P1, clientScope: null })).toEqual([]);
    });

    it('needs at least one client: no scope is spelled null', () => {
      expect(
        codesAt({ ...P1, clientScope: { mode: 'exclude', clients: [] } }, '/clientScope/clients'),
      ).not.toEqual([]);
    });

    it('needs the date an opt-in or opt-out took effect, and no end before it', () => {
      const { startedAt: _started, ...undated } = scope('exclude').clients[0]!;
      expect(
        codesAt(
          { ...P1, clientScope: { mode: 'exclude', clients: [undated] } },
          '/clientScope/clients/0/startedAt',
        ),
      ).not.toEqual([]);
      expect(
        codesAt(
          {
            ...P1,
            clientScope: {
              mode: 'exclude',
              clients: [{ ...undated, startedAt: '2026-04-14', endedAt: '2026-04-01' }],
            },
          },
          '/clientScope/clients/0/endedAt',
        ),
      ).not.toEqual([]);
    });

    it('accepts the Ch4 edit: a new EU engagement scoped to Aurelia, an existing one excluding her', () => {
      const [render, mailcrest, glitchlog] = P1.engagements;
      const exclude = {
        mode: 'exclude',
        clients: [
          { client: 'aurelia', reason: 'EU-only processing (Aurelia DPA)', agreement: AGREEMENT },
        ],
      };
      const input = {
        ...P1,
        engagements: [
          { ...render, id: UUID },
          {
            ...mailcrest,
            id: '0199c3a1-8f2e-7c4d-b8e1-000000000002',
            serviceDescription: 'Candidate notifications (US region)',
            clientScope: exclude,
          },
          { ...glitchlog, id: '0199c3a1-8f2e-7c4d-b8e1-000000000003', clientScope: exclude },
          {
            party: 'mailcrest',
            role: 'subprocessor',
            serviceDescription: 'Candidate notifications (EU region)',
            processingCountries: ['IE'],
            dataCategories: ['identity'],
            transfers: [],
            clientScope: {
              mode: 'include',
              clients: [
                { client: 'aurelia', reason: 'EU data region (Aurelia DPA)', agreement: AGREEMENT },
              ],
            },
          },
        ],
      };
      expect(errorsFor(input)).toEqual([]);
    });

    it('needs a reason on every engagement scope entry', () => {
      const scoped = {
        ...P1.engagements[0],
        clientScope: { mode: 'exclude', clients: [{ client: 'aurelia' }] },
      };
      expect(
        codesAt({ ...P1, engagements: [scoped] }, '/engagements/0/clientScope/clients/0/reason'),
      ).not.toEqual([]);
    });
  });

  describe('joint_controller (DM §10, Q5)', () => {
    it('is accepted by the type and rejected as not yet supported, at /role', () => {
      expect(errorsFor({ role: 'joint_controller', name: 'Shared', owner: 'Priya' })).toEqual([
        {
          path: '/role',
          code: 'not_yet_supported',
          message: 'Joint controller activities are not yet supported',
        },
      ]);
    });
  });

  it('points at /role when the role is missing or unknown', () => {
    expect(errorsFor({ name: 'No role', owner: 'Priya' })[0]?.path).toBe('/role');
    expect(errorsFor({ ...P1, role: 'owner' })[0]?.path).toBe('/role');
  });

  it('rejects an activity that ends before it starts', () => {
    expect(codesAt({ ...C2, endedAt: '2026-01-01' }, '/endedAt')).not.toEqual([]);
  });

  it('rejects a retention period that is not an ISO 8601 duration', () => {
    const retentionRules = [{ retentionPeriod: '90 days', triggerEvent: 'after contract end' }];
    expect(codesAt({ ...C2, retentionRules }, '/retentionRules/0/retentionPeriod')).not.toEqual([]);
  });

  it('rejects a lawful basis outside Art. 6(1)', () => {
    expect(codesAt({ ...C2, lawfulBases: ['6(1)(g)'] }, '/lawfulBases/0')).not.toEqual([]);
  });

  it('keeps nested ids, which is how a PUT tells an update from an insert (§1.4)', () => {
    const parsed = ProcessorActivityInput.parse({
      ...P1,
      engagements: [{ ...P1.engagements[0], id: UUID }],
    });
    expect(parsed.engagements[0]?.id).toBe(UUID);
    expect(
      codesAt({ ...P1, engagements: [{ ...P1.engagements[0], id: 'e1' }] }, '/engagements/0/id'),
    ).not.toEqual([]);
  });

  it('ignores the read-only fields of the activity itself if a caller sends them back', () => {
    const parsed = ActivityInput.parse({
      ...P1,
      id: UUID,
      code: 'P1',
      status: 'active',
      version: 3,
    });
    expect(parsed).not.toHaveProperty('id');
    expect(parsed).not.toHaveProperty('code');
    expect(parsed).not.toHaveProperty('status');
    expect(parsed).not.toHaveProperty('version');
  });

  it('takes a changeNote, which belongs to the revision (§1.6)', () => {
    expect(ProcessorActivityInput.parse(P1).changeNote).toBe(
      'Initial processor record for the ATS',
    );
  });
});

describe('Activity (output)', () => {
  const ref = (slug: string, name: string) => ({ id: UUID, slug, name });
  const meta = {
    id: UUID,
    version: 3,
    createdAt: '2026-02-10T09:12:00Z',
    updatedAt: '2026-06-20T14:03:00Z',
  };
  const common = {
    ...meta,
    description: null,
    owner: 'Priya Raman',
    roleRationale: null,
    supersedes: null,
    subjectCategories: [ref('client-users', 'Client users')],
    dataCategories: [ref('billing', 'Billing data')],
    systems: [ref('hireloop-app', 'Recruiter app')],
    securityMeasures: [],
    reviewDueAt: '2027-02-10',
    startedAt: '2026-02-10',
    endedAt: null,
  };

  /** C2 as `ropa-api.md` §3.3 reads it back. */
  const c2 = {
    ...common,
    code: 'C2',
    name: 'Customer accounts & billing',
    role: 'controller',
    status: 'active',
    purposes: ['Provide contracted service accounts', 'Invoice and collect payment'],
    lawfulBases: ['6(1)(b)', '6(1)(c)'],
    specialConditions: [],
    dpiaRequired: false,
    dpiaRef: null,
    retentionRules: [
      {
        id: UUID,
        dataCategory: ref('billing', 'Billing data'),
        retentionPeriod: 'P7Y',
        triggerEvent: 'after invoice date',
        legalRef: 'Dutch tax law',
      },
    ],
    engagements: [
      {
        id: UUID,
        party: ref('ledgerpay', 'Ledgerpay Ltd'),
        role: 'recipient',
        serviceDescription: 'Payment processing (independent controller)',
        processingCountries: ['IE'],
        dataCategories: [ref('billing', 'Billing data')],
        transfers: [],
        startedAt: null,
        endedAt: null,
      },
    ],
  };

  const p1 = {
    ...common,
    code: 'P1',
    name: 'Candidate application management',
    role: 'processor',
    status: 'draft',
    offering: ref('ats', 'Applicant tracking'),
    clientCoverage: 'all_enrolled',
    processingCategories: ['hosting'],
    clientScope: null,
    dpiaSupportRef: null,
    engagements: [
      {
        id: UUID,
        party: ref('mailcrest', 'Mailcrest Inc.'),
        role: 'subprocessor',
        serviceDescription: 'Candidate notifications (US region)',
        processingCountries: ['US'],
        dataCategories: [ref('identity', 'Identity & contact')],
        transfers: [
          {
            id: UUID,
            destinationCountry: 'US',
            mechanism: 'dpf',
            onwardVia: null,
            documentRef: null,
          },
        ],
        startedAt: null,
        endedAt: null,
        clientScope: {
          mode: 'exclude',
          clients: [
            {
              id: UUID,
              client: ref('aurelia', 'Aurelia Health'),
              reason: 'EU-only processing (Aurelia DPA)',
              agreement: { id: AGREEMENT, name: 'Aurelia DPA' },
            },
          ],
        },
      },
    ],
  };

  it('reads C2 back as the API design shows it (§3.3)', () => {
    expect(Activity.safeParse(c2).success).toBe(true);
  });

  it('reads a processor with a scoped engagement (Ch4)', () => {
    expect(Activity.safeParse(p1).success).toBe(true);
  });

  it('returns every identifier: id, code and name (DM §3.0, Q6)', () => {
    const parsed = Activity.parse(c2);
    expect(parsed.id).toBe(UUID);
    expect(parsed.code).toBe('C2');
    expect(parsed.name).toBe('Customer accounts & billing');
  });

  it('spells an unset optional field as null rather than leaving it out', () => {
    const { dpiaRef: _dpiaRef, ...withoutDpiaRef } = c2;
    expect(Activity.safeParse(withoutDpiaRef).success).toBe(false);
  });

  it('has no joint_controller branch: none can be stored', () => {
    expect(Activity.safeParse({ ...c2, role: 'joint_controller' }).success).toBe(false);
  });
});

describe('inputFromActivity: what the API returns, as the PUT body that saves it unchanged', () => {
  const UUID2 = '0199c3a1-8f2e-7c4d-b8e1-000000000002';
  const ref = (slug: string) => ({ id: UUID2, slug, name: slug });
  const meta = {
    id: UUID,
    version: 2,
    createdAt: '2026-02-12T10:00:00Z',
    updatedAt: '2026-03-16T10:00:00Z',
    description: null,
    owner: 'Priya Raman',
    roleRationale: null,
    supersedes: null,
    subjectCategories: [ref('candidates')],
    dataCategories: [ref('identity')],
    systems: [],
    securityMeasures: [],
    reviewDueAt: null,
    startedAt: '2026-02-12',
    endedAt: null,
  };

  it('keeps every nested id and turns every Ref into its id, for a processor', () => {
    const activity = Activity.parse({
      ...meta,
      code: 'P1',
      name: 'Candidate application management',
      role: 'processor',
      status: 'active',
      offering: ref('ats'),
      clientCoverage: 'all_enrolled',
      processingCategories: ['hosting'],
      clientScope: {
        mode: 'exclude',
        clients: [
          {
            id: UUID,
            client: ref('aurelia'),
            reason: null,
            agreement: null,
            startedAt: '2026-04-14',
            endedAt: null,
          },
        ],
      },
      dpiaSupportRef: null,
      engagements: [
        {
          id: UUID,
          party: ref('mailcrest'),
          role: 'subprocessor',
          serviceDescription: 'Candidate notifications (US region)',
          processingCountries: ['US'],
          dataCategories: [ref('identity')],
          transfers: [
            {
              id: UUID,
              destinationCountry: 'US',
              mechanism: 'dpf',
              onwardVia: null,
              documentRef: null,
            },
          ],
          startedAt: null,
          endedAt: null,
          clientScope: {
            mode: 'exclude',
            clients: [
              { id: UUID, client: ref('aurelia'), reason: 'EU only', agreement: ref('dpa') },
            ],
          },
        },
      ],
    });

    const body = inputFromActivity(activity);
    expect(validateActivityShape(body)).toEqual([]);
    expect(body).toMatchObject({
      offering: UUID2,
      clientScope: { mode: 'exclude', clients: [{ id: UUID, client: UUID2 }] },
      engagements: [
        {
          id: UUID,
          party: UUID2,
          transfers: [{ id: UUID, destinationCountry: 'US' }],
          clientScope: { clients: [{ id: UUID, agreement: UUID2 }] },
        },
      ],
    });
    expect(body).not.toHaveProperty('code');
    expect(body).not.toHaveProperty('version');
  });

  it('keeps a controller’s retention rules by id, and the default rule without a category', () => {
    const body = inputFromActivity(
      Activity.parse({
        ...meta,
        code: 'C2',
        name: 'Customer accounts & billing',
        role: 'controller',
        status: 'active',
        purposes: ['Invoice'],
        lawfulBases: ['6(1)(b)'],
        specialConditions: [],
        retentionRules: [
          {
            id: UUID,
            dataCategory: null,
            retentionPeriod: 'P90D',
            triggerEvent: 'after end',
            legalRef: null,
          },
        ],
        dpiaRequired: false,
        dpiaRef: null,
        engagements: [],
      }),
    );
    expect(validateActivityShape(body)).toEqual([]);
    expect(body['retentionRules']).toEqual([
      { id: UUID, retentionPeriod: 'P90D', triggerEvent: 'after end' },
    ]);
  });
});

describe('the OpenAPI shape (§3.1)', () => {
  const inputSchema = z.toJSONSchema(ActivityInput, { target: 'draft-2020-12', io: 'input' });
  const outputSchema = z.toJSONSchema(Activity, { target: 'draft-2020-12', io: 'output' });

  it('is oneOf with a discriminator on role, going in and coming out', () => {
    expect(inputSchema['oneOf']).toHaveLength(3);
    expect(outputSchema['oneOf']).toHaveLength(2);
    expect(inputSchema['discriminator']).toEqual({ propertyName: 'role' });
    expect(outputSchema['discriminator']).toEqual({ propertyName: 'role' });
  });

  it('documents a forbidden field as one no value satisfies', () => {
    const members = inputSchema['oneOf'] as { properties: Record<string, unknown> }[];
    const processor = members.find(
      (member) => (member.properties['role'] as { const?: string }).const === 'processor',
    );
    expect(processor?.properties['purposes']).toEqual({ not: {} });
  });
});

describe('the lifecycle bodies (§3.4)', () => {
  it('lets activate carry a changeNote, and nothing else matters', () => {
    expect(ActivateInput.parse({ changeNote: 'Reviewed' })).toEqual({ changeNote: 'Reviewed' });
    expect(ActivateInput.parse({})).toEqual({});
  });

  it('lets retire carry an end date, which must be a real date', () => {
    expect(RetireInput.parse({ endedAt: '2026-09-30' }).endedAt).toBe('2026-09-30');
    expect(RetireInput.safeParse({ endedAt: '2026-02-30' }).success).toBe(false);
    expect(RetireInput.parse({})).toEqual({});
  });
});
