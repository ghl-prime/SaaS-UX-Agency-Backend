import type { RequestHandler } from 'express';
import { AUTH_COOKIE } from '../config/constants.js';
import { effectivePermissions, type Permission } from '../config/permissions.js';
import { AdminModel, type AdminDocument } from '../modules/auth/admin.model.js';
import { verifyToken } from '../modules/auth/token.js';
import { ApiError } from '../utils/ApiError.js';

declare global {
  namespace Express {
    interface Request {
      admin?: AdminDocument;
    }
  }
}

function readToken(cookies: Record<string, string> | undefined, header?: string): string | undefined {
  const fromCookie = cookies?.[AUTH_COOKIE];
  if (fromCookie) return fromCookie;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return undefined;
}

/** Requires a valid session (httpOnly cookie, or `Authorization: Bearer` for API clients) of an active user. */
export const requireAdmin: RequestHandler = async (req, _res, next) => {
  const token = readToken(req.cookies, req.headers.authorization);
  const payload = token ? verifyToken(token) : null;
  if (!payload) throw ApiError.unauthorized();

  const admin = await AdminModel.findById(payload.sub);
  if (!admin || admin.status !== 'active' || (admin.sessionVersion ?? 0) !== payload.v) throw ApiError.unauthorized();

  req.admin = admin;
  next();
};

export function hasPermission(admin: AdminDocument | undefined, ...anyOf: Permission[]): boolean {
  if (!admin) return false;
  if (admin.role === 'developer') return true;
  const granted = effectivePermissions(admin.role, admin.permissions);
  return anyOf.some((p) => granted.includes(p));
}

/** Passes when the signed-in user has at least one of the permissions (developers always pass). */
export function requirePermission(...anyOf: Permission[]): RequestHandler {
  return (req, _res, next) => {
    if (!hasPermission(req.admin, ...anyOf)) throw ApiError.forbidden('You don’t have access to this area');
    next();
  };
}

/**
 * Different permissions for reading and changing a resource. `read` covers GET
 * requests (plus any extra read-like requests `isRead` accepts, e.g. uploads from
 * an image picker); everything else needs `write`.
 */
export function permit(opts: { read: Permission[]; write: Permission[]; isRead?: (method: string, path: string) => boolean }): RequestHandler {
  return (req, _res, next) => {
    const read = req.method === 'GET' || req.method === 'HEAD' || Boolean(opts.isRead?.(req.method, req.path));
    if (!hasPermission(req.admin, ...(read ? opts.read : opts.write))) throw ApiError.forbidden('You don’t have access to this area');
    next();
  };
}

export const requireDeveloper: RequestHandler = (req, _res, next) => {
  if (req.admin?.role !== 'developer') throw ApiError.forbidden('Only developers can change these settings');
  next();
};
