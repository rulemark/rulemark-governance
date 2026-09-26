import { PERMISSIONS, PRINCIPAL_ROLES } from '@rulemark/ropa-schemas';
import { describe, expect, it } from 'vitest';

import { PRINCIPAL_ROLE_PERMISSIONS, permissionsFor } from './permissions.js';

describe('the permission map (§1.9)', () => {
  it('defines every role, and only real permissions', () => {
    expect(Object.keys(PRINCIPAL_ROLE_PERMISSIONS).sort()).toEqual([...PRINCIPAL_ROLES].sort());
    for (const [role, permissions] of Object.entries(PRINCIPAL_ROLE_PERMISSIONS)) {
      for (const permission of permissions) {
        expect(PERMISSIONS, `${role} grants ${permission}`).toContain(permission);
      }
    }
  });

  it('gives a viewer reading, history and every view, and no writing', () => {
    const viewer = permissionsFor(['viewer']);
    expect(viewer).toContain('record:read');
    expect(viewer).toContain('history:read');
    expect(viewer).toContain('review:read');
    expect(PERMISSIONS.filter((p) => p.startsWith('view:')).every((p) => viewer.includes(p))).toBe(
      true,
    );
    expect(viewer).not.toContain('record:write');
  });

  it('separates editing from approving, which is the point of the split', () => {
    // Tomás drafts, Priya approves.
    expect(permissionsFor(['editor'])).toContain('record:write');
    expect(permissionsFor(['editor'])).not.toContain('activity:approve');

    expect(permissionsFor(['approver'])).toContain('activity:approve');
    expect(permissionsFor(['approver'])).not.toContain('record:write');
  });

  it('gives an editor everything a viewer has', () => {
    for (const permission of permissionsFor(['viewer'])) {
      expect(permissionsFor(['editor'])).toContain(permission);
    }
  });

  it('gives admin everything, including deleting and taxonomy writes', () => {
    expect(permissionsFor(['admin']).sort()).toEqual([...PERMISSIONS].sort());
  });

  it('keeps deleting away from everyone else', () => {
    for (const role of PRINCIPAL_ROLES) {
      if (role === 'admin') continue;
      expect(permissionsFor([role]), role).not.toContain('record:delete');
    }
  });

  it("holds the monitor's token to impact, subprocessors and review items", () => {
    expect(permissionsFor(['service:monitor']).sort()).toEqual(
      ['review:create', 'review:read', 'view:impact', 'view:subprocessors'].sort(),
    );
  });

  it('lets the snapshot write systems but not records in general', () => {
    const snapshot = permissionsFor(['service:snapshot']);
    expect(snapshot).toContain('system:write');
    expect(snapshot).toContain('record:read');
    expect(snapshot).not.toContain('record:write');
  });

  it('holds the DSAR tracker to reading and the data map', () => {
    expect(permissionsFor(['service:dsar']).sort()).toEqual(['record:read', 'view:datamap'].sort());
  });

  it('combines the roles on a token', () => {
    const priya = permissionsFor(['editor', 'approver']);
    expect(priya).toContain('record:write');
    expect(priya).toContain('activity:approve');
  });

  it('returns each permission once, however many roles grant it', () => {
    const permissions = permissionsFor(['editor', 'approver', 'viewer']);
    expect(new Set(permissions).size).toBe(permissions.length);
  });

  it('grants nothing to no roles', () => {
    expect(permissionsFor([])).toEqual([]);
  });
});
