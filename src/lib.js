// Shared helpers: responses, security headers, input cleaning, hashing, sessions, rate limits and spam tokens.
// Nothing secret lives in this file. Keys come from Cloudflare secrets (env) and the database.

export const PUBLIC_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self' https://checkout.stripe.com";
export const ADMIN_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'";

export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const clean = (v, max) => String(v == null ? '' : v).replace(/\r/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
export const line = (v, max) => clean(Array.isArray(v) ? v[0] : v, max * 2).replace(/\s+/g, ' ').trim().slice(0, max);
export const EMAIL_RE = /^[^\s@<>"(),;:]+@[^\s@<>"(),;:]+\.[a-z]{2,}$/i;
export const POSTCODE_RE = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/i;
export function normPostcode(v) { const m = POSTCODE_RE.exec(clean(v, 12).toUpperCase()); return m ? m[1] + ' ' + m[2] : ''; }
export function normPhone(v) {
  const d = clean(v, 30).replace(/[^\d+]/g, '');
  const n = d.startsWith('+44') ? '0' + d.slice(3) : d.startsWith('44') && d.length === 12 ? '0' + d.slice(2) : d;
  return /^0\d{9,10}$/.test(n) ? n : '';
}
export const prettyPhone = n => !n ? '' : /^07/.test(n) ? n.slice(0, 5) + ' ' + n.slice(5) : /^0(1\d1|2)/.test(n) ? n.slice(0, 3) + ' ' + n.slice(3, 6) + ' ' + n.slice(6) : n.slice(0, 5) + ' ' + n.slice(5);
export const money = p => '£' + (Math.round(Number(p) || 0) / 100).toFixed(2).replace(/\.00$/, '');
export const money2 = p => '£' + (Math.round(Number(p) || 0) / 100).toFixed(2);
export const slugify = s => clean(s, 80).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';
export const todayUK = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const niceDate = iso => iso ? new Date(String(iso).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';
export const isoDate = v => { const s = clean(v, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ''; const d = new Date(s + 'T12:00:00Z'); return isNaN(d) || d.toISOString().slice(0, 10) !== s ? '' : s; };

/* ---------- responses ---------- */
export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', ...extra } });
}
export function secure(res, url, csp = PUBLIC_CSP) {
  const out = new Response(res.body, res);
  out.headers.set('X-Content-Type-Options', 'nosniff');
  if (!out.headers.get('Referrer-Policy')) out.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  out.headers.set('X-Frame-Options', 'DENY');
  out.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()');
  out.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  if (csp && (out.headers.get('Content-Type') || '').includes('text/html')) out.headers.set('Content-Security-Policy', csp);
  if (url.protocol === 'https:') out.headers.set('Strict-Transport-Security', 'max-age=31536000');
  return out;
}
export function html(body, url, { status = 200, cache = 'no-store', cookies = [], noindex = false } = {}) {
  const res = new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': cache } });
  for (const c of cookies) res.headers.append('Set-Cookie', c);
  if (noindex) res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return secure(res, url);
}
export function redirect(to, status = 303, cookies = []) {
  const res = new Response(null, { status, headers: { Location: to, 'Cache-Control': 'no-store' } });
  for (const c of cookies) res.headers.append('Set-Cookie', c);
  return res;
}
// blocks form posts and API calls that come from another website (CSRF)
export function sameOrigin(req, url) {
  const o = req.headers.get('origin');
  if (o) return o === url.origin;
  const r = req.headers.get('referer');
  return !!r && r.startsWith(url.origin + '/');
}
export async function readJson(req, max = 512 * 1024) { try { const t = await req.text(); if (t.length > max) return null; const v = JSON.parse(t, (k, x) => (k === '__proto__' || k === 'constructor' || k === 'prototype') ? undefined : x); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; } }
export async function readForm(req) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > 64 * 1024) return null;
  try {
    const f = await req.formData(), o = Object.create(null);
    for (const [k, v] of f.entries()) {
      if (typeof v !== 'string' || k.length > 40 || k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      if (o[k] === undefined) o[k] = v; else o[k] = [].concat(o[k], v).slice(0, 40);
    }
    return o;
  } catch { return null; }
}

/* ---------- crypto ---------- */
const enc = new TextEncoder();
export const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
export function randomHex(n) { const b = new Uint8Array(n); crypto.getRandomValues(b); return hex(b); }
export function newId() { return Date.now().toString(36) + randomHex(5); }
export async function sha256hex(s) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))); }
export async function hmacHex(key, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg))));
}
function bytesEqual(a, b) { if (a.length !== b.length || !a.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; }
export async function safeEqual(a, b) {
  const ha = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(a))));
  const hb = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(b))));
  return bytesEqual(ha, hb) && String(a).length > 0;
}
const b64e = b => btoa(String.fromCharCode(...b));
function b64d(s) { try { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); } catch { return new Uint8Array(0); } }
async function pbkdf2(pw, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}
export async function hashPassword(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), it = 100000;
  return `pbkdf2$${it}$${b64e(salt)}$${b64e(await pbkdf2(pw, salt, it))}`;
}
export async function verifyPassword(pw, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') { await pbkdf2(String(pw), new Uint8Array(16), 100000); return false; }
  return bytesEqual(await pbkdf2(String(pw), b64d(parts[2]), Math.min(parseInt(parts[1], 10) || 1, 100000)), b64d(parts[3]));
}
export function passwordProblem(pw, ...avoid) {
  if (String(pw).length < 10) return 'Use a password of at least 10 characters.';
  if (String(pw).length > 200) return 'That password is too long.';
  for (const a of avoid) if (a && a.length > 2 && String(pw).toLowerCase().includes(String(a).toLowerCase())) return "Your password can't contain your username.";
  if (/^(password|1234567890|qwertyuiop|chocolate1)/i.test(pw)) return 'Choose a less common password.';
  return '';
}

/* ---------- cookies and sessions ---------- */
export const ADMIN_COOKIE = '__Host-choc_admin';
export const SESSION_TTL = 12 * 3600;
export function readCookie(req, name) {
  for (const part of (req.headers.get('cookie') || '').split(';')) { const i = part.indexOf('='); if (i > -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim(); }
  return null;
}
export async function createSession(env, username) {
  const id = randomHex(32);
  await env.DB.prepare('INSERT INTO sessions (id, username, exp) VALUES (?, ?, ?)').bind(await sha256hex(id), username, Date.now() + SESSION_TTL * 1000).run();
  return `${ADMIN_COOKIE}=${id}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL}`;
}
export async function getSession(req, env) {
  const id = readCookie(req, ADMIN_COOKIE);
  if (!id || !/^[a-f0-9]{64}$/.test(id)) return null;
  const s = await env.DB.prepare('SELECT s.username, s.exp FROM sessions s JOIN admins a ON a.username = s.username WHERE s.id = ?').bind(await sha256hex(id)).first();
  if (!s || s.exp < Date.now()) return null;
  return s;
}
export async function endSession(req, env) {
  const id = readCookie(req, ADMIN_COOKIE);
  if (id && /^[a-f0-9]{64}$/.test(id)) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256hex(id)).run();
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

/* ---------- rate limiting (IPs are only kept as one-way hashes, for an hour at most) ---------- */
export async function limit(env, req, bucket, max, seconds) {
  const key = bucket + ':' + (await sha256hex('rl' + (req.headers.get('cf-connecting-ip') || 'unknown'))).slice(0, 32);
  const row = await env.DB.prepare('SELECT n, exp FROM ratelimit WHERE key = ?').bind(key).first();
  const n = row && row.exp > Date.now() ? row.n : 0;
  return {
    blocked: n >= max,
    hit: () => env.DB.prepare('INSERT INTO ratelimit (key, n, exp) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET n = CASE WHEN exp < ?3 THEN 1 ELSE n + 1 END, exp = CASE WHEN exp < ?3 THEN ?2 ELSE exp END').bind(key, Date.now() + seconds * 1000, Date.now()).run(),
    clear: () => env.DB.prepare('DELETE FROM ratelimit WHERE key = ?').bind(key).run()
  };
}

/* ---------- spam token for public forms: must be at least 3 seconds old, used once ---------- */
export async function formToken(env) { const ts = String(Date.now()), r = randomHex(6); return ts + '.' + r + '.' + (await hmacHex(await secretKey(env, 'formkey'), ts + r)).slice(0, 32); }
export async function checkToken(env, tok, minMs = 3000) {
  const [ts, r, sig] = String(tok || '').split('.');
  if (!/^\d{13}$/.test(ts || '') || !/^[a-f0-9]{12}$/.test(r || '') || !sig) return 'bad';
  const age = Date.now() - Number(ts);
  if (age > 2 * 86400000) return 'old';
  if (!(await safeEqual(sig, (await hmacHex(await secretKey(env, 'formkey'), ts + r)).slice(0, 32)))) return 'bad';
  if (age < minMs) return 'fast';
  const used = await env.DB.prepare('INSERT OR IGNORE INTO ratelimit (key, n, exp) VALUES (?, 1, ?)').bind('tok:' + r, Date.now() + 2 * 86400000).run();
  if (used && used.meta && used.meta.changes === 0) return 'used';
  return 'ok';
}
// random keys kept in the database, made on first use (never shown anywhere)
const keyCache = {};
export async function secretKey(env, name) {
  if (keyCache[name]) return keyCache[name];
  let row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('k_' + name).first();
  if (!row) { await env.DB.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind('k_' + name, randomHex(32)).run(); row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('k_' + name).first(); }
  return (keyCache[name] = row.value);
}

/* ---------- activity log ---------- */
export async function log(env, req, who, action) {
  try {
    const cf = (req && req.cf) || {};
    await env.DB.prepare('INSERT INTO log (at, who, action, place) VALUES (?, ?, ?, ?)').bind(Date.now(), String(who || '').slice(0, 60), String(action).slice(0, 200), [cf.city, cf.country].filter(Boolean).join(', ')).run();
  } catch (e) { console.error('log failed', e); }
}
