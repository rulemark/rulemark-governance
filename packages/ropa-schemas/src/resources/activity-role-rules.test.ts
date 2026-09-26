import { describe, expect, it } from 'vitest';

import { ROLE_FIELDS, canActivate, describeRoleRules } from './index.js';

/** The rule each role gives each field, straight from DM §5. */
function rulesOf(role: 'controller' | 'processor') {
  const { fields } = describeRoleRules(role);
  return Object.fromEntries(ROLE_FIELDS.map((field) => [field, fields[field].rule]));
}

describe('describeRoleRules', () => {
  it('matches the controller column of DM §5', () => {
    expect(rulesOf('controller')).toEqual({
      purposes: 'required',
      lawfulBases: 'required',
      specialConditions: 'optional',
      retentionRules: 'required',
      dpiaRequired: 'optional',
      dpiaRef: 'optional',
      offering: 'forbidden',
      clientCoverage: 'forbidden',
      processingCategories: 'forbidden',
      clientScope: 'forbidden',
      dpiaSupportRef: 'forbidden',
    });
  });

  it('matches the processor column of DM §5', () => {
    expect(rulesOf('processor')).toEqual({
      purposes: 'forbidden',
      lawfulBases: 'forbidden',
      specialConditions: 'forbidden',
      retentionRules: 'forbidden',
      dpiaRequired: 'forbidden',
      dpiaRef: 'forbidden',
      offering: 'required',
      clientCoverage: 'required',
      processingCategories: 'required',
      clientScope: 'optional',
      dpiaSupportRef: 'optional',
    });
  });

  it('says why a conditional field is conditional, so a form can show it', () => {
    expect(describeRoleRules('controller').fields.specialConditions.note).toMatch(/special/);
    expect(describeRoleRules('processor').fields.clientScope.note).toMatch(/opt_in/);
  });

  it('lists the engagement roles each activity role allows', () => {
    expect(describeRoleRules('controller').engagementRoles).toEqual(['processor', 'recipient']);
    expect(describeRoleRules('processor').engagementRoles).toEqual(['subprocessor']);
  });

  it('allows engagement client scope on processor activities only', () => {
    expect(describeRoleRules('controller').engagementClientScope).toBe('forbidden');
    expect(describeRoleRules('processor').engagementClientScope).toBe('optional');
  });
});

describe('canActivate', () => {
  const completeController = {
    role: 'controller',
    purposes: ['Recruitment'],
    lawfulBases: ['6(1)(f)'],
    retentionRules: [{ retentionPeriod: 'P90D', triggerEvent: 'after contract end' }],
  } as const;

  const completeProcessor = {
    role: 'processor',
    offering: 'ats',
    clientCoverage: 'all_enrolled',
    processingCategories: ['hosting'],
  } as const;

  it('passes a complete controller and a complete processor', () => {
    expect(canActivate(completeController)).toEqual([]);
    expect(canActivate(completeProcessor)).toEqual([]);
  });

  it('names every missing field of an incomplete controller draft', () => {
    expect(canActivate({ role: 'controller', purposes: [], lawfulBases: [] })).toEqual([
      {
        path: '/purposes',
        code: 'required_for_role',
        message: 'Controller activities need purposes before they can be activated (Art. 30(1)(b))',
      },
      {
        path: '/lawfulBases',
        code: 'required_for_role',
        message: 'Controller activities need lawful bases before they can be activated (Art. 6(1))',
      },
      {
        path: '/retentionRules',
        code: 'required_for_role',
        message:
          'Controller activities need retention rules before they can be activated (at least one; Art. 30(1)(f))',
      },
    ]);
  });

  it('names every missing field of an incomplete processor draft', () => {
    const paths = canActivate({ role: 'processor' }).map((error) => error.path);
    expect(paths).toEqual(['/offering', '/clientCoverage', '/processingCategories']);
  });

  it('reads a stored activity too, where an unset field is null', () => {
    expect(canActivate({ ...completeProcessor, offering: null }).map((e) => e.path)).toEqual([
      '/offering',
    ]);
  });

  it('leaves Art. 9 conditions to the server, which knows which categories are special', () => {
    expect(canActivate({ ...completeController, specialConditions: [] })).toEqual([]);
  });

  it('rejects joint_controller as not yet supported (DM §10, Q5)', () => {
    expect(canActivate({ role: 'joint_controller' })).toEqual([
      {
        path: '/role',
        code: 'not_yet_supported',
        message: 'Joint controller activities are not yet supported',
      },
    ]);
  });
});
