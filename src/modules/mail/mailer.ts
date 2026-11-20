import nodemailer from 'nodemailer';
import { ApiError } from '../../utils/ApiError.js';
import { decryptSecret, getSetting } from '../settings/setting.model.js';

export const SMTP_SETTING = 'smtp';

/** Stored shape of the `smtp` setting. The app password is kept encrypted. */
export interface SmtpSettings {
  enabled: boolean;
  host: string;
  port: number;
  /** true = implicit TLS (port 465). false = STARTTLS (587) or plain. */
  secure: boolean;
  user: string;
  passEncrypted?: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

function transportFor(s: SmtpSettings, pass: string) {
  return nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure,
    auth: s.user ? { user: s.user, pass } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

/** Loads SMTP settings; `null` when email isn't set up or is switched off. */
export async function loadSmtp(): Promise<{ settings: SmtpSettings; pass: string } | null> {
  const settings = await getSetting<SmtpSettings>(SMTP_SETTING);
  if (!settings?.enabled || !settings.host || !settings.fromEmail) return null;
  const pass = decryptSecret(settings.passEncrypted) ?? '';
  if (settings.user && !pass) return null;
  return { settings, pass };
}

export async function isMailConfigured(): Promise<boolean> {
  return (await loadSmtp()) !== null;
}

/** Turns SMTP errors into something an admin can act on. */
export function describeSmtpError(err: unknown): string {
  const e = err as { code?: string; responseCode?: number; message?: string };
  if (e.code === 'EAUTH' || e.responseCode === 535)
    return 'The SMTP server rejected the username or app password. For Gmail, use a 16-character App Password (Google Account → Security → App passwords), not your normal password.';
  if (e.code === 'ESOCKET' || e.code === 'ECONNECTION' || e.code === 'ETIMEDOUT' || e.code === 'ECONNREFUSED')
    return 'Could not connect to the SMTP server. Check the host and port, and that "Use SSL/TLS" matches the port (465 = on, 587 = off).';
  if (e.code === 'EENVELOPE') return 'The server refused the sender or recipient address. Check the “From email”.';
  return e.message ? `Email could not be sent: ${e.message}` : 'Email could not be sent';
}

/** Send with explicit settings (used by "Send test email" before saving). */
export async function sendWith(settings: SmtpSettings, pass: string, msg: MailMessage): Promise<void> {
  const from = settings.fromName ? `"${settings.fromName.replace(/"/g, '')}" <${settings.fromEmail}>` : settings.fromEmail;
  try {
    await transportFor(settings, pass).sendMail({ from, replyTo: settings.replyTo || undefined, ...msg });
  } catch (err) {
    throw ApiError.badRequest(describeSmtpError(err));
  }
}

/** Send using the saved settings. Throws a 400 explaining what to fix if email isn't configured. */
export async function sendMail(msg: MailMessage): Promise<void> {
  const smtp = await loadSmtp();
  if (!smtp) throw ApiError.badRequest('Email isn’t set up yet. A developer can configure SMTP in Settings → Email.');
  await sendWith(smtp.settings, smtp.pass, msg);
}

/** Best-effort send: returns whether the email went out instead of throwing. */
export async function trySendMail(msg: MailMessage): Promise<{ sent: boolean; error?: string }> {
  try {
    await sendMail(msg);
    return { sent: true };
  } catch (err) {
    const error = err instanceof ApiError ? err.message : 'Email could not be sent';
    console.warn(`[mail] ${msg.subject} → ${msg.to}: ${error}`);
    return { sent: false, error };
  }
}
