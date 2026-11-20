/**
 * Roles and permissions.
 *
 * - `developer`: full access to everything, including SMTP/email settings and managing other developers.
 * - `admin`: access only to the areas a developer (or an admin with `users`) grants them.
 *
 * `settings` (SMTP + app password) is never grantable: it's implied by the developer role.
 */
export const ROLES = ['developer', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = ['projects', 'media', 'pageImages', 'seo', 'users'] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** What a newly invited admin gets unless the inviter picks otherwise. */
export const DEFAULT_ADMIN_PERMISSIONS: Permission[] = ['projects', 'media', 'pageImages', 'seo'];

/** Any of these lets someone browse and upload to the media library (needed by every image picker). */
export const CONTENT_PERMISSIONS: Permission[] = ['projects', 'media', 'pageImages', 'seo'];

export function effectivePermissions(role: Role, permissions: readonly string[] = []): Permission[] {
  if (role === 'developer') return [...PERMISSIONS];
  return PERMISSIONS.filter((p) => permissions.includes(p));
}
