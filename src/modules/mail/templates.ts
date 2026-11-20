import type { MailMessage } from './mailer.js';

const BRAND = 'SaaX';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Simple, client-safe HTML email: table layout, inline styles, one call-to-action. */
function layout(opts: { heading: string; paragraphs: string[]; cta?: { label: string; url: string }; footnote?: string; extraHtml?: string }) {
  const p = opts.paragraphs.map((t) => `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#3f3f46">${t}</p>`).join('');
  const button = opts.cta
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 24px"><tr><td style="border-radius:10px;background:#18181b">
        <a href="${esc(opts.cta.url)}" style="display:inline-block;padding:13px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px">${esc(opts.cta.label)}</a>
      </td></tr></table>
      <p style="margin:0 0 16px;font-size:12px;line-height:18px;color:#71717a">Or paste this link into your browser:<br><a href="${esc(opts.cta.url)}" style="color:#047857;word-break:break-all">${esc(opts.cta.url)}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f5;padding:32px 16px"><tr><td align="center">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:16px;border:1px solid #e4e4e7">
      <tr><td style="padding:24px 32px;border-bottom:1px solid #f4f4f5">
        <span style="font-size:18px;font-weight:700;color:#18181b">${BRAND}</span>
        <span style="margin-left:8px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#71717a">Admin</span>
      </td></tr>
      <tr><td style="padding:32px">
        <h1 style="margin:0 0 16px;font-size:22px;line-height:30px;color:#18181b">${opts.heading}</h1>
        ${p}${opts.extraHtml ?? ''}${button}
        ${opts.footnote ? `<p style="margin:0;font-size:12px;line-height:18px;color:#a1a1aa">${opts.footnote}</p>` : ''}
      </td></tr>
    </table>
    <p style="margin:16px 0 0;font-size:12px;color:#a1a1aa">© ${BRAND}</p>
  </td></tr></table></body></html>`;
}

function text(lines: (string | undefined | false)[]): string {
  return lines.filter(Boolean).join('\n\n');
}

export function inviteEmail(o: { to: string; name: string; inviterName: string; role: string; url: string; expiresDays: number }): MailMessage {
  const role = o.role === 'developer' ? 'a developer' : 'an admin';
  return {
    to: o.to,
    subject: `${o.inviterName} invited you to the ${BRAND} admin portal`,
    html: layout({
      heading: `You’re invited, ${esc(o.name)}`,
      paragraphs: [`<strong>${esc(o.inviterName)}</strong> invited you to join the ${BRAND} admin portal as ${role}.`, 'Set your password to activate your account.'],
      cta: { label: 'Accept invitation', url: o.url },
      footnote: `This invitation expires in ${o.expiresDays} days. If you weren’t expecting it, you can ignore this email.`,
    }),
    text: text([`${o.inviterName} invited you to the ${BRAND} admin portal as ${role}.`, `Accept the invitation: ${o.url}`, `The link expires in ${o.expiresDays} days.`]),
  };
}

export function credentialsEmail(o: { to: string; name: string; inviterName: string; password: string; loginUrl: string }): MailMessage {
  const box = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;background:#fafafa;border:1px solid #e4e4e7;border-radius:10px"><tr><td style="padding:16px 18px;font-size:14px;line-height:22px;color:#3f3f46">
    <div><span style="color:#71717a">Email</span><br><strong>${esc(o.to)}</strong></div>
    <div style="margin-top:10px"><span style="color:#71717a">Temporary password</span><br><code style="font-size:15px;font-weight:600;color:#18181b">${esc(o.password)}</code></div>
  </td></tr></table>`;
  return {
    to: o.to,
    subject: `Your ${BRAND} admin account`,
    html: layout({
      heading: `Welcome, ${esc(o.name)}`,
      paragraphs: [`<strong>${esc(o.inviterName)}</strong> created a ${BRAND} admin account for you. Sign in with:`],
      extraHtml: box,
      cta: { label: 'Sign in', url: o.loginUrl },
      footnote: 'For your security, change this password after signing in (your name menu → Account).',
    }),
    text: text([`${o.inviterName} created a ${BRAND} admin account for you.`, `Email: ${o.to}\nTemporary password: ${o.password}`, `Sign in: ${o.loginUrl}`, 'Please change this password after signing in.']),
  };
}

export function resetEmail(o: { to: string; name: string; url: string; expiresMinutes: number; requestedBy?: string }): MailMessage {
  const intro = o.requestedBy
    ? `${esc(o.requestedBy)} sent you a link to set a new password for your ${BRAND} admin account.`
    : `We received a request to reset the password for your ${BRAND} admin account.`;
  return {
    to: o.to,
    subject: `Reset your ${BRAND} admin password`,
    html: layout({
      heading: `Hi ${esc(o.name)},`,
      paragraphs: [intro, 'Choose a new password using the button below.'],
      cta: { label: 'Reset password', url: o.url },
      footnote: `This link expires in ${o.expiresMinutes} minutes and can be used once. If you didn’t ask for this, you can ignore this email: your password won’t change.`,
    }),
    text: text([intro, `Reset your password: ${o.url}`, `The link expires in ${o.expiresMinutes} minutes.`]),
  };
}

export function passwordChangedEmail(o: { to: string; name: string }): MailMessage {
  return {
    to: o.to,
    subject: `Your ${BRAND} admin password was changed`,
    html: layout({
      heading: `Hi ${esc(o.name)},`,
      paragraphs: [`The password for your ${BRAND} admin account was just changed, and other sessions were signed out.`, 'If this wasn’t you, reset your password right away and tell a developer on your team.'],
    }),
    text: `The password for your ${BRAND} admin account was just changed. If this wasn't you, reset your password and contact a developer.`,
  };
}

export function testEmail(o: { to: string; name: string }): MailMessage {
  return {
    to: o.to,
    subject: `${BRAND} SMTP test`,
    html: layout({ heading: 'Email is working 🎉', paragraphs: [`Hi ${esc(o.name)}, this test confirms the ${BRAND} admin can send email. Invitations and password resets will now be delivered.`] }),
    text: `Hi ${o.name}, this test confirms the ${BRAND} admin can send email.`,
  };
}
