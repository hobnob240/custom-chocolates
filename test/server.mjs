// Local harness: the real worker with an in-memory D1 (node:sqlite), static assets, and mocked Stripe + Resend + photo fetches.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'), PUB = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8810);
let sql = new DatabaseSync(':memory:');
const conv = a => a.map(x => x instanceof Uint8Array ? x : x === undefined ? null : typeof x === 'boolean' ? (x ? 1 : 0) : x);
const stmt = (q, a = []) => ({ q, a, bind: (...b) => stmt(q, b), async first() { return sql.prepare(q).get(...conv(a)) || null; }, async all() { return { results: sql.prepare(q).all(...conv(a)) }; }, async run() { const r = sql.prepare(q).run(...conv(a)); return { success: true, meta: { changes: Number(r.changes) } }; } });
const DB = { prepare: q => stmt(q), async batch(list) { const out = []; sql.exec('BEGIN'); try { for (const x of list) out.push(/^\s*(SELECT|WITH)/i.test(x.q) ? await x.all() : await x.run()); sql.exec('COMMIT'); } catch (e) { sql.exec('ROLLBACK'); throw e; } return out; } };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.txt': 'text/plain' };
const ASSETS = { async fetch(req) {
  let p = decodeURIComponent(new URL(req.url).pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(PUB, p);
  if (f.startsWith(PUB) && fs.existsSync(f) && fs.statSync(f).isFile()) return new Response(fs.readFileSync(f), { headers: { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' } });
  return new Response('Not found', { status: 404 });
} };
globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };
const sessions = new Map(), calls = [], emails = [];
const realFetch = globalThis.fetch;
const JPEG = fs.existsSync('/tmp/choc-stock.jpg') ? fs.readFileSync('/tmp/choc-stock.jpg') : Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === 'string' ? input : input.url);
  if (u.hostname === 'upload.wikimedia.org') return new Response(JPEG, { headers: { 'Content-Type': 'image/jpeg' } });
  if (u.hostname === 'api.resend.com') { emails.push(JSON.parse(init.body)); return Response.json({ id: 'em_' + emails.length }); }
  if (u.hostname === 'api.stripe.com') {
    calls.push({ method: init.method, path: u.pathname, body: init.body });
    if (init.headers.Authorization !== 'Bearer ' + env.STRIPE_SECRET_KEY) return Response.json({ error: { message: 'bad key' } }, { status: 401 });
    if (init.method === 'POST' && u.pathname === '/v1/checkout/sessions') {
      const p = new URLSearchParams(init.body); const id = 'cs_test_' + Math.random().toString(36).slice(2, 12);
      let total = 0; for (let i = 0; p.get(`line_items[${i}][quantity]`); i++) total += Number(p.get(`line_items[${i}][quantity]`)) * Number(p.get(`line_items[${i}][price_data][unit_amount]`));
      const s = { id, object: 'checkout.session', amount_total: total, payment_status: 'unpaid', metadata: { kind: p.get('metadata[kind]'), id: p.get('metadata[id]') }, customer_email: p.get('customer_email'), success_url: p.get('success_url'), url: 'https://checkout.stripe.com/c/pay/' + id };
      sessions.set(id, s); return Response.json(s);
    }
    const m = /^\/v1\/checkout\/sessions\/(cs_\w+)$/.exec(u.pathname);
    if (init.method === 'GET' && m) { const s = sessions.get(m[1]); return s ? Response.json(s) : Response.json({ error: { message: 'No such session' } }, { status: 404 }); }
    return Response.json({ error: { message: 'unmocked' } }, { status: 400 });
  }
  return realFetch(input, init);
};
const env = { DB, ASSETS, SETUP_CODE: process.env.SETUP_CODE ?? 'velvet ganache test', STRIPE_SECRET_KEY: process.env.NOSTRIPE ? '' : 'sk_test_abc123XYZ', STRIPE_WEBHOOK_SECRET: process.env.NOSTRIPE ? '' : 'whsec_testsecret123', RESEND_API_KEY: process.env.NOEMAIL ? '' : 're_test_123', EMAIL_FROM: 'Shop <orders@example.com>' };
const worker = (await import(path.join(ROOT, 'src/worker.js'))).default;
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  if (req.url.startsWith('/__test/')) {
    const u = new URL('http://x' + req.url); const cmd = u.pathname.split('/')[2]; const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
    if (cmd === 'q') { try { return res.end(JSON.stringify(sql.prepare(body.q).all(...(body.a || [])))); } catch (e) { res.statusCode = 500; return res.end(String(e)); } }
    if (cmd === 'x') { try { sql.prepare(body.q).run(...(body.a || [])); return res.end('ok'); } catch (e) { res.statusCode = 500; return res.end(String(e)); } }
    if (cmd === 'cron') { const ps = []; await worker.scheduled({}, env, { waitUntil: p => ps.push(p) }); await Promise.all(ps); return res.end('ok'); }
    if (cmd === 'pay') { const s = sessions.get(body.id); s.payment_status = 'paid'; return res.end(JSON.stringify(s)); }
    if (cmd === 'sessions') return res.end(JSON.stringify([...sessions.values()]));
    if (cmd === 'calls') return res.end(JSON.stringify(calls));
    if (cmd === 'emails') return res.end(JSON.stringify(emails));
    if (cmd === 'env') { Object.assign(env, body); return res.end('ok'); }
  }
  const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  const r = new Request(`http://localhost:${PORT}` + req.url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks), redirect: 'manual' });
  const ps = [];
  let out; try { out = await worker.fetch(r, env, { waitUntil(p) { ps.push(p); } }); } catch (e) { console.error(e); res.writeHead(500); return res.end('crash'); }
  await Promise.all(ps).catch(e => console.error('waitUntil', e));
  const h = {}; out.headers.forEach((v, k) => { if (k !== 'set-cookie') h[k] = v; });
  const sc = out.headers.getSetCookie(); if (sc.length) h['set-cookie'] = sc;
  res.writeHead(out.status, h); res.end(Buffer.from(await out.arrayBuffer()));
}).listen(PORT, () => console.log('ready on ' + PORT));
