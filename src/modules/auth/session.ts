import type { CookieOptions, Response } from 'express';
import { AUTH_COOKIE } from '../../config/constants.js';
import { env } from '../../config/env.js';
import type { AdminDocument } from './admin.model.js';
import { signToken } from './token.js';

export const cookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: env.isProd,
  path: '/',
};

export const INVITE_TTL_DAYS = 7;
export const RESET_TTL_MINUTES = 60;

export function issueSession(res: Response, admin: AdminDocument) {
  const token = signToken({ sub: admin.id, role: admin.role, v: admin.sessionVersion ?? 0 });
  res.cookie(AUTH_COOKIE, token, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });
}

export const links = {
  login: () => `${env.appUrl}/admin/login`,
  invite: (token: string) => `${env.appUrl}/admin/accept-invite?token=${token}`,
  reset: (token: string) => `${env.appUrl}/admin/reset-password?token=${token}`,
};

export const passwordRule = (label = 'Password') =>
  ({ min: 8, max: 128, message: `${label} must be 8–128 characters` }) as const;
