import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { DEFAULT_ADMIN_PERMISSIONS, PERMISSIONS, ROLES, effectivePermissions, type Permission } from '../../config/permissions.js';
import { ApiError } from '../../utils/ApiError.js';
import { validate } from '../../utils/validate.js';
import { AdminModel, createOneTimeToken, generatePassword, toPublicAdmin, type AdminDocument } from '../auth/admin.model.js';
import { INVITE_TTL_DAYS, RESET_TTL_MINUTES, links, passwordRule } from '../auth/session.js';
import { isMailConfigured, trySendMail } from '../mail/mailer.js';
import { credentialsEmail, inviteEmail, resetEmail } from '../mail/templates.js';

/** Team management. Mounted behind `requirePermission('users')`. */
export const usersRouter = Router();

const rule = passwordRule();
const password = z.string().min(rule.min, rule.message).max(rule.max, rule.message);
const objectId = z.string().refine(isValidObjectId, 'Invalid id');
const permissions = z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length);

/**
 * Rules:
 * - Developers manage everyone.
 * - Admins (with `users`) manage admins only, and can't grant permissions they don't have.
 * - Nobody changes their own role, permissions or status here (use Account for name/password).
 * - There is always at least one active developer.
 */
function assertCanGrant(actor: AdminDocument, role: (typeof ROLES)[number], perms: Permission[] | undefined) {
  if (actor.role === 'developer') return;
  if (role === 'developer') throw ApiError.forbidden('Only developers can add or promote developers');
  const own = effectivePermissions(actor.role, actor.permissions);
  const extra = (perms ?? []).filter((p) => !own.includes(p));
  if (extra.length) throw ApiError.forbidden(`You can’t grant access you don’t have: ${extra.join(', ')}`);
}

function assertCanManage(actor: AdminDocument, target: AdminDocument) {
  if (actor.role !== 'developer' && target.role === 'developer') throw ApiError.forbidden('Only developers can change a developer account');
}

async function assertNotLastDeveloper(target: AdminDocument) {
  if (target.role !== 'developer' || target.status !== 'active') return;
  const others = await AdminModel.countDocuments({ _id: { $ne: target._id }, role: 'developer', status: 'active' });
  if (!others) throw ApiError.badRequest('There must always be at least one active developer');
}

async function loadTarget(id: string) {
  const target = await AdminModel.findById(validate(objectId, id));
  if (!target) throw ApiError.notFound('User not found');
  return target;
}

function issueInvite(user: AdminDocument) {
  const t = createOneTimeToken();
  user.inviteTokenHash = t.hash;
  user.inviteExpiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);
  return links.invite(t.raw);
}

// ───────── List ─────────

usersRouter.get('/', async (_req, res) => {
  const users = await AdminModel.find().sort({ role: -1, status: 1, createdAt: 1 }).populate<{ invitedBy: { name: string } | null }>('invitedBy', { name: 1 });
  res.json({
    items: users.map((u) => ({ ...toPublicAdmin(u), invitedBy: u.invitedBy?.name ?? null })),
    mailConfigured: await isMailConfigured(),
    permissions: PERMISSIONS,
  });
});

// ───────── Add (invite by email, or create with a password) ─────────

const createBody = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('invite'),
    email: z.string().trim().toLowerCase().email('Enter a valid email'),
    name: z.string().trim().max(80).optional(),
    role: z.enum(ROLES).default('admin'),
    permissions: permissions.optional(),
  }),
  z.object({
    mode: z.literal('password'),
    email: z.string().trim().toLowerCase().email('Enter a valid email'),
    name: z.string().trim().min(1, 'Enter a name').max(80),
    role: z.enum(ROLES).default('admin'),
    permissions: permissions.optional(),
    /** Omit to generate a strong password. */
    password: password.optional(),
    sendEmail: z.boolean().default(true),
  }),
]);

usersRouter.post('/', async (req, res) => {
  const actor = req.admin!;
  const body = validate(createBody, req.body);
  const perms = body.role === 'developer' ? [] : (body.permissions ?? DEFAULT_ADMIN_PERMISSIONS);
  assertCanGrant(actor, body.role, perms);
  if (await AdminModel.exists({ email: body.email })) throw ApiError.conflict('Someone with that email is already on the team');

  if (body.mode === 'invite') {
    const user = new AdminModel({
      email: body.email,
      name: body.name || body.email.split('@')[0],
      role: body.role,
      permissions: perms,
      status: 'invited',
      invitedBy: actor._id,
    });
    const inviteUrl = issueInvite(user);
    await user.save();
    const mail = await trySendMail(
      inviteEmail({ to: user.email, name: user.name, inviterName: actor.name, role: user.role, url: inviteUrl, expiresDays: INVITE_TTL_DAYS }),
    );
    res.status(201).json({ item: toPublicAdmin(user), inviteUrl, emailed: mail.sent, emailError: mail.error });
    return;
  }

  const plain = body.password ?? generatePassword();
  const user = await AdminModel.create({
    email: body.email,
    name: body.name,
    role: body.role,
    permissions: perms,
    status: 'active',
    passwordHash: await AdminModel.hashPassword(plain),
    invitedBy: actor._id,
  });
  const mail = body.sendEmail
    ? await trySendMail(credentialsEmail({ to: user.email, name: user.name, inviterName: actor.name, password: plain, loginUrl: links.login() }))
    : { sent: false, error: undefined };
  // The password is returned once so the inviter can share it if email is off.
  res.status(201).json({ item: toPublicAdmin(user), password: plain, emailed: mail.sent, emailError: mail.error });
});

// ───────── Update role / permissions / status / name ─────────

const updateBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  role: z.enum(ROLES).optional(),
  permissions: permissions.optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

usersRouter.patch('/:id', async (req, res) => {
  const actor = req.admin!;
  const body = validate(updateBody, req.body);
  const target = await loadTarget(req.params.id as string);
  assertCanManage(actor, target);

  const isSelf = target.id === actor.id;
  if (isSelf && (body.role || body.permissions || body.status)) throw ApiError.badRequest('You can’t change your own role, access or status');

  const nextRole = body.role ?? target.role;
  assertCanGrant(actor, nextRole, body.permissions);
  if ((body.role && body.role !== 'developer') || body.status === 'disabled') await assertNotLastDeveloper(target);

  if (body.name !== undefined) target.name = body.name;
  if (body.role) target.role = body.role;
  if (body.permissions) target.permissions = [...new Set(body.permissions)];
  if (target.role === 'developer') target.permissions = [];
  if (body.status) {
    if (target.status === 'invited' && body.status === 'active') throw ApiError.badRequest('This person needs to accept their invitation first');
    if (target.status !== 'invited') target.status = body.status;
    // Disabling signs them out everywhere immediately.
    if (body.status === 'disabled') target.sessionVersion = (target.sessionVersion ?? 0) + 1;
  }
  await target.save();
  res.json({ item: toPublicAdmin(target) });
});

// ───────── Re-send invitation ─────────

usersRouter.post('/:id/resend-invite', async (req, res) => {
  const actor = req.admin!;
  const target = await loadTarget(req.params.id as string);
  assertCanManage(actor, target);
  if (target.status !== 'invited') throw ApiError.badRequest('This person has already joined');

  const inviteUrl = issueInvite(target);
  await target.save();
  const mail = await trySendMail(
    inviteEmail({ to: target.email, name: target.name, inviterName: actor.name, role: target.role, url: inviteUrl, expiresDays: INVITE_TTL_DAYS }),
  );
  res.json({ item: toPublicAdmin(target), inviteUrl, emailed: mail.sent, emailError: mail.error });
});

// ───────── Password help for a team member ─────────

const passwordBody = z.discriminatedUnion('mode', [
  /** Email them a reset link (link is also returned so it can be shared manually). */
  z.object({ mode: z.literal('link') }),
  /** Set a new password now (generated if omitted), optionally emailing it. */
  z.object({ mode: z.literal('set'), password: password.optional(), sendEmail: z.boolean().default(false) }),
]);

usersRouter.post('/:id/password', async (req, res) => {
  const actor = req.admin!;
  const body = validate(passwordBody, req.body);
  const target = await loadTarget(req.params.id as string);
  assertCanManage(actor, target);
  if (target.id === actor.id) throw ApiError.badRequest('Change your own password from Account');
  if (target.status === 'disabled') throw ApiError.badRequest('Reactivate this account first');

  if (body.mode === 'link') {
    const t = createOneTimeToken();
    target.resetTokenHash = t.hash;
    target.resetExpiresAt = new Date(Date.now() + 24 * 60 * 60_000);
    await target.save();
    const resetUrl = links.reset(t.raw);
    const mail = await trySendMail(resetEmail({ to: target.email, name: target.name, url: resetUrl, expiresMinutes: 24 * 60, requestedBy: actor.name }));
    res.json({ resetUrl, emailed: mail.sent, emailError: mail.error, expiresMinutes: Math.max(RESET_TTL_MINUTES, 24 * 60) });
    return;
  }

  const plain = body.password ?? generatePassword();
  target.passwordHash = await AdminModel.hashPassword(plain);
  target.sessionVersion = (target.sessionVersion ?? 0) + 1;
  if (target.status === 'invited') {
    target.status = 'active';
    target.inviteTokenHash = null;
    target.inviteExpiresAt = null;
  }
  await target.save();
  const mail = body.sendEmail
    ? await trySendMail(credentialsEmail({ to: target.email, name: target.name, inviterName: actor.name, password: plain, loginUrl: links.login() }))
    : { sent: false, error: undefined };
  res.json({ password: plain, emailed: mail.sent, emailError: mail.error, item: toPublicAdmin(target) });
});

// ───────── Remove ─────────

usersRouter.delete('/:id', async (req, res) => {
  const actor = req.admin!;
  const target = await loadTarget(req.params.id as string);
  assertCanManage(actor, target);
  if (target.id === actor.id) throw ApiError.badRequest('You can’t remove your own account');
  await assertNotLastDeveloper(target);
  await target.deleteOne();
  res.json({ ok: true });
});
