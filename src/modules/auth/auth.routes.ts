import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { AUTH_COOKIE } from '../../config/constants.js';
import { env } from '../../config/env.js';
import { requireAdmin } from '../../middleware/auth.js';
import { ApiError } from '../../utils/ApiError.js';
import { validate } from '../../utils/validate.js';
import { isMailConfigured, trySendMail } from '../mail/mailer.js';
import { passwordChangedEmail, resetEmail } from '../mail/templates.js';
import { AdminModel, createOneTimeToken, hashToken, toPublicAdmin } from './admin.model.js';
import { RESET_TTL_MINUTES, cookieOptions, issueSession, links, passwordRule } from './session.js';

const rule = passwordRule();
const password = z.string().min(rule.min, rule.message).max(rule.max, rule.message);
const email = z.string().trim().toLowerCase().email('Enter a valid email');
const token = z.string().regex(/^[a-f0-9]{64}$/, 'This link is invalid');

const limiter = (limit: number, message: string) =>
  rateLimit({ windowMs: 15 * 60 * 1000, limit, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { message } } });

const loginLimiter = limiter(20, 'Too many login attempts, try again later');
const recoveryLimiter = limiter(8, 'Too many requests, try again in a few minutes');

export const authRouter = Router();

// ───────── Sign in / out ─────────

authRouter.post('/login', loginLimiter, async (req, res) => {
  const body = validate(z.object({ email, password: z.string().min(1) }), req.body);
  const admin = await AdminModel.findOne({ email: body.email }).select('+passwordHash');
  if (!admin || !(await admin.verifyPassword(body.password))) {
    throw ApiError.unauthorized('Invalid email or password');
  }
  if (admin.status === 'disabled') throw ApiError.forbidden('This account has been deactivated. Ask a developer to restore access.');
  if (admin.status === 'invited') throw ApiError.forbidden('Accept your invitation email first to activate this account.');

  admin.lastLoginAt = new Date();
  await admin.save();
  issueSession(res, admin);
  res.json({ admin: toPublicAdmin(admin) });
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(AUTH_COOKIE, cookieOptions);
  res.json({ ok: true });
});

// ───────── Current user ─────────

authRouter.get('/me', requireAdmin, async (req, res) => {
  res.json({ admin: toPublicAdmin(req.admin!), mailConfigured: await isMailConfigured() });
});

authRouter.patch('/me', requireAdmin, async (req, res) => {
  const body = validate(z.object({ name: z.string().trim().min(1, 'Name is required').max(80) }), req.body);
  req.admin!.name = body.name;
  await req.admin!.save();
  res.json({ admin: toPublicAdmin(req.admin!) });
});

authRouter.post('/me/password', requireAdmin, loginLimiter, async (req, res) => {
  const body = validate(z.object({ currentPassword: z.string().min(1, 'Enter your current password'), newPassword: password }), req.body);
  const admin = await AdminModel.findById(req.admin!._id).select('+passwordHash');
  if (!admin || !(await admin.verifyPassword(body.currentPassword))) throw ApiError.badRequest('Your current password is incorrect');
  if (body.currentPassword === body.newPassword) throw ApiError.badRequest('Choose a password different from the current one');

  admin.passwordHash = await AdminModel.hashPassword(body.newPassword);
  admin.sessionVersion = (admin.sessionVersion ?? 0) + 1;
  await admin.save();
  // Keep this browser signed in; every other session is now invalid.
  issueSession(res, admin);
  void trySendMail(passwordChangedEmail({ to: admin.email, name: admin.name }));
  res.json({ ok: true });
});

// ───────── Forgot / reset password ─────────

authRouter.post('/forgot-password', recoveryLimiter, async (req, res) => {
  const body = validate(z.object({ email }), req.body);
  const admin = await AdminModel.findOne({ email: body.email, status: 'active' });

  // Same response whether or not the account exists, so emails can't be probed.
  if (admin) {
    const t = createOneTimeToken();
    admin.resetTokenHash = t.hash;
    admin.resetExpiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60_000);
    await admin.save();
    const url = links.reset(t.raw);
    const result = await trySendMail(resetEmail({ to: admin.email, name: admin.name, url, expiresMinutes: RESET_TTL_MINUTES }));
    if (!result.sent && !env.isProd) console.log(`[dev] Password reset link for ${admin.email}: ${url}`);
  }
  res.json({ ok: true });
});

async function findByResetToken(raw: string) {
  const admin = await AdminModel.findOne({ resetTokenHash: hashToken(raw) }).select('+resetTokenHash +passwordHash');
  if (!admin || !admin.resetExpiresAt || admin.resetExpiresAt < new Date()) {
    throw ApiError.badRequest('This reset link has expired or was already used. Request a new one.');
  }
  if (admin.status === 'disabled') throw ApiError.forbidden('This account has been deactivated.');
  return admin;
}

authRouter.get('/reset-password/:token', recoveryLimiter, async (req, res) => {
  const admin = await findByResetToken(validate(token, req.params.token));
  res.json({ email: admin.email, name: admin.name });
});

authRouter.post('/reset-password', recoveryLimiter, async (req, res) => {
  const body = validate(z.object({ token, password }), req.body);
  const admin = await findByResetToken(body.token);

  admin.passwordHash = await AdminModel.hashPassword(body.password);
  admin.sessionVersion = (admin.sessionVersion ?? 0) + 1;
  admin.resetTokenHash = null;
  admin.resetExpiresAt = null;
  // A reset link sent to an invited user doubles as accepting the invite.
  if (admin.status === 'invited') admin.status = 'active';
  admin.lastLoginAt = new Date();
  await admin.save();

  issueSession(res, admin);
  void trySendMail(passwordChangedEmail({ to: admin.email, name: admin.name }));
  res.json({ admin: toPublicAdmin(admin) });
});

// ───────── Accept invitation ─────────

async function findByInviteToken(raw: string) {
  const admin = await AdminModel.findOne({ inviteTokenHash: hashToken(raw), status: 'invited' })
    .select('+inviteTokenHash')
    .populate<{ invitedBy: { name: string } | null }>('invitedBy', { name: 1 });
  if (!admin || !admin.inviteExpiresAt || admin.inviteExpiresAt < new Date()) {
    throw ApiError.badRequest('This invitation has expired or was already used. Ask the person who invited you to send a new one.');
  }
  return admin;
}

authRouter.get('/invite/:token', recoveryLimiter, async (req, res) => {
  const admin = await findByInviteToken(validate(token, req.params.token));
  res.json({ email: admin.email, name: admin.name, role: admin.role, invitedBy: admin.invitedBy?.name ?? null });
});

authRouter.post('/invite/accept', recoveryLimiter, async (req, res) => {
  const body = validate(z.object({ token, name: z.string().trim().min(1, 'Enter your name').max(80), password }), req.body);
  const found = await findByInviteToken(body.token);
  const admin = (await AdminModel.findById(found._id))!;

  admin.name = body.name;
  admin.passwordHash = await AdminModel.hashPassword(body.password);
  admin.status = 'active';
  admin.inviteTokenHash = null;
  admin.inviteExpiresAt = null;
  admin.lastLoginAt = new Date();
  await admin.save();

  issueSession(res, admin);
  res.json({ admin: toPublicAdmin(admin) });
});
