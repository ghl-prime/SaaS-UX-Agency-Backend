import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../../config/env.js';

export interface TokenPayload {
  sub: string;
  role: string;
  /** The user's `sessionVersion` when signed; a password change invalidates older tokens. */
  v: number;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'] });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (typeof decoded === 'string' || typeof decoded.sub !== 'string') return null;
    return { sub: decoded.sub, role: String(decoded.role ?? ''), v: Number(decoded.v ?? 0) };
  } catch {
    return null;
  }
}
