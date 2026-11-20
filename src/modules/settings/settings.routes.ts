import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../../utils/ApiError.js';
import { validate } from '../../utils/validate.js';
import { SMTP_SETTING, sendWith, type SmtpSettings } from '../mail/mailer.js';
import { testEmail } from '../mail/templates.js';
import { decryptSecret, encryptSecret, getSetting, putSetting } from './setting.model.js';

/** Developer-only (mounted behind `requireDeveloper`). */
export const settingsRouter = Router();

const smtpBody = z.object({
  enabled: z.boolean(),
  host: z.string().trim().min(1, 'SMTP host is required').max(200),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().trim().max(200).default(''),
  /** Omit or leave empty to keep the saved app password. */
  password: z.string().max(500).optional(),
  fromName: z.string().trim().max(80).default(''),
  fromEmail: z.string().trim().toLowerCase().email('Enter a valid “From” email'),
  replyTo: z.union([z.string().trim().toLowerCase().email(), z.literal('')]).default(''),
});

function serialize(s: (SmtpSettings & { updatedAt?: Date }) | null) {
  return {
    enabled: s?.enabled ?? false,
    host: s?.host ?? '',
    port: s?.port ?? 465,
    secure: s?.secure ?? true,
    user: s?.user ?? '',
    hasPassword: Boolean(s?.passEncrypted && decryptSecret(s.passEncrypted)),
    fromName: s?.fromName ?? 'SaaX',
    fromEmail: s?.fromEmail ?? '',
    replyTo: s?.replyTo ?? '',
    updatedAt: s?.updatedAt ?? null,
  };
}

settingsRouter.get('/smtp', async (_req, res) => {
  res.json({ item: serialize(await getSetting<SmtpSettings>(SMTP_SETTING)) });
});

settingsRouter.put('/smtp', async (req, res) => {
  const body = validate(smtpBody, req.body);
  const existing = await getSetting<SmtpSettings>(SMTP_SETTING);
  // Spaces are common when copying Gmail app passwords ("abcd efgh ijkl mnop").
  const newPass = body.password?.replace(/\s+/g, '');

  const next: SmtpSettings = {
    enabled: body.enabled,
    host: body.host,
    port: body.port,
    secure: body.secure,
    user: body.user,
    passEncrypted: newPass ? encryptSecret(newPass) : existing?.passEncrypted,
    fromName: body.fromName,
    fromEmail: body.fromEmail,
    replyTo: body.replyTo,
  };
  if (next.enabled && next.user && !decryptSecret(next.passEncrypted)) {
    throw ApiError.badRequest('Enter the SMTP app password');
  }
  await putSetting(SMTP_SETTING, next, req.admin?._id);
  res.json({ item: serialize({ ...next, updatedAt: new Date() }) });
});

const testBody = z.object({
  to: z.string().trim().toLowerCase().email().optional(),
  /** Unsaved form values: test before saving. Falls back to the saved settings. */
  settings: smtpBody.partial({ enabled: true }).optional(),
});

settingsRouter.post('/smtp/test', async (req, res) => {
  const { to, settings } = validate(testBody, req.body ?? {});
  const saved = await getSetting<SmtpSettings>(SMTP_SETTING);
  const cfg = settings ?? saved;
  if (!cfg?.host || !cfg.fromEmail) throw ApiError.badRequest('Fill in the SMTP host and From email first');

  const typedPass = settings?.password?.replace(/\s+/g, '');
  const pass = typedPass || decryptSecret(saved?.passEncrypted) || '';
  if (cfg.user && !pass) throw ApiError.badRequest('Enter the SMTP app password');

  const recipient = to ?? req.admin!.email;
  await sendWith(
    { enabled: true, host: cfg.host, port: cfg.port ?? 465, secure: cfg.secure ?? true, user: cfg.user ?? '', fromName: cfg.fromName ?? '', fromEmail: cfg.fromEmail, replyTo: cfg.replyTo },
    pass,
    testEmail({ to: recipient, name: req.admin!.name }),
  );
  res.json({ ok: true, to: recipient });
});
