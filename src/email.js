// Optional email alerts through Resend (https://resend.com). Only used if both secrets are set in Cloudflare:
// RESEND_API_KEY and EMAIL_FROM (e.g. "Book a Medium Night <alerts@yourdomain.co.uk>"). Nothing is sent otherwise.
export const emailReady = env => /^re_[A-Za-z0-9_]+$/.test(String(env.RESEND_API_KEY || '')) && /@/.test(String(env.EMAIL_FROM || ''));

export async function sendEmail(env, { to, subject, text }) {
  if (!emailReady(env)) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text })
    });
    if (!r.ok) console.error('email failed', r.status, await r.text().catch(() => ''));
    return r.ok;
  } catch (e) { console.error('email error', e.message); return false; }
}
