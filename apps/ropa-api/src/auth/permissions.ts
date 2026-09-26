import { PERMISSIONS, type Permission, type PrincipalRole } from '@rulemark/ropa-schemas';

/**
 * Which permissions each role carries (`ropa-api.md` §1.9). The server is
 * authoritative: a token names roles, and this map decides what they mean, so
 * a stale client cannot grant itself anything.
 *
 * Two splits are deliberate:
 *
 * - **Editing is not approving.** `record:write` changes a draft;
 *   `activity:approve` puts it live. With `If-Match` required on activate
 *   (§1.8), the approver is provably approving the version they reviewed. In
 *   the story, Tomás drafts and Priya approves.
 * - **Services get their own narrow roles.** Render describes its private
 *   network as a workspace-level trust model, not zero-trust, so a service
 *   authenticates at the application layer like anyone else. The Monitor's
 *   token can open review items and read impact, and nothing else.
 */
const VIEWS = PERMISSIONS.filter((permission) => permission.startsWith('view:'));

const VIEWER: readonly Permission[] = ['record:read', 'history:read', 'review:read', ...VIEWS];

export const PRINCIPAL_ROLE_PERMISSIONS: Readonly<Record<PrincipalRole, readonly Permission[]>> = {
  viewer: VIEWER,
  editor: [...VIEWER, 'record:write', 'review:create', 'review:resolve'],
  approver: [...VIEWER, 'activity:approve'],
  admin: PERMISSIONS,
  'service:monitor': ['view:impact', 'view:subprocessors', 'review:read', 'review:create'],
  'service:snapshot': ['record:read', 'system:write', 'view:coverage', 'review:create'],
  'service:dsar': ['record:read', 'view:datamap'],
};

/** What a token's roles add up to. Roles combine; nothing subtracts. */
export function permissionsFor(roles: readonly PrincipalRole[]): Permission[] {
  const granted = new Set<Permission>();
  for (const role of roles) {
    for (const permission of PRINCIPAL_ROLE_PERMISSIONS[role] ?? []) granted.add(permission);
  }
  return [...granted];
}
