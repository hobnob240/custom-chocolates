// Card payments through Stripe Checkout. The shop owner's keys live only in Cloudflare secrets
// (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET), never in pages, code or the database.
// Card details are typed on Stripe's own page, so they never touch this site.
import { hmacHex, safeEqual } from './lib.js';

export const stripeReady = env => /^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(String(env.STRIPE_SECRET_KEY || ''));
export const stripeMode = env => /_live_/.test(String(env.STRIPE_SECRET_KEY || '')) ? 'live' : 'test';

async function stripe(env, method, path, params) {
  const r = await fetch('https://api.stripe.com/v1/' + path, {
    method,
    headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2024-06-20' },
    body: params ? new URLSearchParams(params).toString() : undefined
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d.error && d.error.message) || 'Stripe error ' + r.status);
  return d;
}

// lines: [{ name, unit (pence), qty }]
export async function createCheckout(env, { origin, lines, email, kind, id, successPath, cancelPath, shopName, description }) {
  const p = {
    mode: 'payment',
    customer_email: email || undefined,
    client_reference_id: id,
    'metadata[kind]': kind,
    'metadata[id]': id,
    'payment_intent_data[metadata][kind]': kind,
    'payment_intent_data[metadata][id]': id,
    'payment_intent_data[description]': (shopName + ' ' + (description || '')).trim().slice(0, 200),
    success_url: origin + successPath + (successPath.includes('?') ? '&' : '?') + 'session_id={CHECKOUT_SESSION_ID}',
    cancel_url: origin + cancelPath,
    expires_at: String(Math.floor(Date.now() / 1000) + 60 * 60),
    locale: 'en-GB'
  };
  lines.forEach((l, i) => {
    p[`line_items[${i}][quantity]`] = String(l.qty);
    p[`line_items[${i}][price_data][currency]`] = 'gbp';
    p[`line_items[${i}][price_data][unit_amount]`] = String(l.unit);
    p[`line_items[${i}][price_data][product_data][name]`] = String(l.name).slice(0, 120);
  });
  for (const k of Object.keys(p)) if (p[k] === undefined) delete p[k];
  return stripe(env, 'POST', 'checkout/sessions', p);
}
export async function getCheckout(env, sid) {
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sid || '')) throw new Error('Unknown payment');
  return stripe(env, 'GET', 'checkout/sessions/' + sid);
}

// Verify the Stripe-Signature header (t=timestamp,v1=signature) on a webhook.
export async function verifyWebhook(env, body, header, toleranceSec = 300) {
  if (!env.STRIPE_WEBHOOK_SECRET) return false;
  const parts = Object.fromEntries(String(header || '').split(',').map(p => { const i = p.indexOf('='); return [p.slice(0, i).trim(), p.slice(i + 1).trim()]; }).filter(x => x[0]));
  const t = parts.t;
  if (!/^\d{9,11}$/.test(t || '')) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return false;
  const want = await hmacHex(env.STRIPE_WEBHOOK_SECRET, t + '.' + body);
  const given = String(header).split(',').map(p => p.trim()).filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  for (const g of given) if (await safeEqual(g, want)) return true;
  return false;
}
