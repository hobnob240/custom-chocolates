// End-to-end checks against the local harness (node test/server.mjs).
import crypto from 'node:crypto';
const B = 'http://localhost:' + (process.env.PORT || 8810);
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL:', msg); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const T = (p, body) => fetch(B + '/__test/' + p, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined }).then(r => r.text());
const Q = async (q, a) => JSON.parse(await T('q', { q, a }));
class Jar { constructor() { this.c = {}; } h() { return Object.entries(this.c).map(([k, v]) => k + '=' + v).join('; '); }
  take(r) { for (const s of r.headers.getSetCookie()) { const [kv] = s.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (/Max-Age=0/.test(s)) delete this.c[k]; else this.c[k] = v; } } }
async function req(jar, method, path, { form, json, headers = {}, origin = true, xrw = true } = {}) {
  const h = { ...headers }; if (jar) h.cookie = jar.h(); if (origin && method !== 'GET') h.origin = B;
  if (xrw && path.startsWith('/admin/api/')) h['x-requested-with'] = 'choc';
  let body; if (form) { body = new URLSearchParams(); for (const [k, v] of Object.entries(form)) [].concat(v).forEach(x => body.append(k, x)); h['content-type'] = 'application/x-www-form-urlencoded'; }
  if (json !== undefined) { body = JSON.stringify(json); h['content-type'] = 'application/json'; }
  const r = await fetch(B + path, { method, headers: h, body, redirect: 'manual' }); if (jar) jar.take(r);
  const text = await r.text(); let data = null; try { data = JSON.parse(text); } catch {}
  return { status: r.status, loc: r.headers.get('location'), text, data, headers: r.headers };
}
const tok = html => (/name="t" value="([^"]+)"/.exec(html) || [])[1];
const future = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

// ---------- public pages + headers ----------
for (const p of ['/', '/shop/', '/bespoke/', '/weddings/', '/gallery/', '/allergens/', '/delivery/', '/faq/', '/contact/', '/privacy/', '/terms/', '/basket/']) {
  const r = await req(null, 'GET', p);
  ok(r.status === 200, p + ' loads');
  ok(/script-src 'self'/.test(r.headers.get('content-security-policy') || ''), p + ' has CSP');
  ok(r.headers.get('x-frame-options') === 'DENY', p + ' no framing');
  ok(!/sk_test|whsec_|re_test|velvet ganache/.test(r.text), p + ' leaks no secret');
}
let r = await req(null, 'GET', '/shop'); ok(r.status === 301 && r.loc === '/shop/', 'trailing slash redirect');
r = await req(null, 'GET', '/shop/box-of-handmade-chocolates/'); ok(r.status === 404, 'draft product hidden');
r = await req(null, 'GET', '/shop/'); ok(/being stocked/.test(r.text), 'empty shop message');

// ---------- admin auth ----------
const adm = new Jar();
r = await req(adm, 'GET', '/admin/api/products'); ok(r.status === 401, 'api needs login');
r = await req(adm, 'POST', '/admin/api/setup', { json: { code: 'wrong code here', username: 'maker', password: 'cocoa butter lantern' } }); ok(r.status === 403, 'wrong setup code');
r = await req(adm, 'POST', '/admin/api/setup', { json: { code: 'velvet ganache test', username: 'maker', password: 'cocoa butter lantern' }, xrw: false }); ok(r.status === 403, 'setup needs custom header');
r = await req(adm, 'POST', '/admin/api/setup', { json: { code: 'velvet ganache test', username: 'maker', password: 'short' } }); ok(r.status === 400 && /10 characters/.test(r.data.error), 'weak password refused');
r = await req(adm, 'POST', '/admin/api/setup', { json: { code: 'velvet ganache test', username: 'maker', password: 'cocoa butter lantern' } }); ok(r.status === 200 && /^[a-f0-9]{64}$/.test(adm.c['__Host-choc_admin'] || ''), 'setup creates login');
ok(/HttpOnly; Secure; SameSite=Strict/.test(r.headers.get('set-cookie')), 'cookie flags');
r = await req(new Jar(), 'POST', '/admin/api/setup', { json: { code: 'velvet ganache test', username: 'evil', password: 'cocoa butter lantern2' } }); ok(r.status === 400, 'setup only once');
const admins = await Q('SELECT * FROM admins'); ok(admins.length === 1 && admins[0].hash.startsWith('pbkdf2$') && !admins[0].hash.includes('cocoa'), 'password stored hashed');
const sess = await Q('SELECT id FROM sessions'); ok(sess.length === 1 && sess[0].id !== adm.c['__Host-choc_admin'], 'session id stored hashed');
// lockout
const bad = new Jar();
for (let i = 0; i < 6; i++) await req(bad, 'POST', '/admin/api/login', { json: { username: 'maker', password: 'nope nope nope' } });
r = await req(bad, 'POST', '/admin/api/login', { json: { username: 'maker', password: 'cocoa butter lantern' } }); ok(r.status === 429, 'login locks after 6 fails');
await T('x', { q: "DELETE FROM ratelimit WHERE key LIKE 'login:%'" });
r = await req(bad, 'POST', '/admin/api/login', { json: { username: 'maker', password: 'cocoa butter lantern' } }); ok(r.status === 200, 'login works');
r = await req(adm, 'PUT', '/admin/api/content', { json: { content: {} }, headers: { origin: 'https://evil.example' }, origin: false }); ok(r.status === 403, 'cross-site admin write blocked');
r = await req(null, 'GET', '/admin/'); ok(/frame-ancestors 'none'/.test(r.headers.get('content-security-policy') || '') && r.headers.get('x-robots-tag'), 'admin page headers');
r = await req(null, 'GET', '/admin/app.js'); ok(!/sk_|whsec|password\s*[:=]\s*['"][^'"]+['"]/.test(r.text), 'admin script has no secrets');

// ---------- website content ----------
r = await req(adm, 'GET', '/admin/api/content'); const content = r.data.content;
const newC = { ...content, name: 'Cocoa & Co', contact: { ...content.contact, email: 'hello@example.com', phone: '07700 900123', instagram: 'javascript:alert(1)' }, legal: { ...content.legal, tradingName: 'Cocoa & Co', address: '1 Test Street, Stoke-on-Trent ST1 1AA' }, delivery: { collect: { on: true, feePounds: '0', text: 'Collect from Stoke' }, local: { on: true, feePounds: '4.50', text: 'Within 10 miles' }, post: { on: false, feePounds: '0', text: '' } }, noticeDays: 5 };
r = await req(adm, 'PUT', '/admin/api/content', { json: { content: newC } }); ok(r.status === 200 && r.data.content.contact.instagram === '' && r.data.content.delivery.local.fee === 450, 'content saved, bad link dropped, fee in pence');
r = await req(null, 'GET', '/'); ok(/Cocoa &amp; Co/.test(r.text) && !/javascript:alert/.test(r.text), 'name escaped on site');

// ---------- products ----------
r = await req(adm, 'POST', '/admin/api/products', { json: { name: 'Salted caramel box <script>alert(1)</script>', price: '18.50', published: true } }); ok(r.status === 400 && /allergens/.test(r.data.error), 'cannot publish without allergen check');
r = await req(adm, 'POST', '/admin/api/products', { json: { name: 'Salted caramel box <script>alert(1)</script>', category: 'Boxes', price: '18.50', summary: 'Nine salted caramels', allergens: ['milk', 'soya', 'bogus'], may_contain: 'nuts', allergens_checked: true, published: true, max_qty: 5 } });
ok(r.status === 200 && r.data.id, 'product created'); const pid = r.data.id, slug = r.data.slug;
ok(slug === 'salted-caramel-box-script-alert-1-script', 'slug made: ' + slug);
r = await req(adm, 'POST', '/admin/api/products', { json: { name: 'Hidden draft', price: '5' } }); const draftId = r.data.id;
r = await req(null, 'GET', '/shop/'); ok(r.text.includes('Salted caramel box &lt;script&gt;') && !r.text.includes('<script>alert') && r.text.includes('£18.50') && !r.text.includes('Hidden draft'), 'shop lists published product escaped');
r = await req(null, 'GET', '/shop/' + slug + '/'); ok(r.status === 200 && /Contains: <strong>Milk, Soya<\/strong>/.test(r.text) && /May contain: nuts/.test(r.text), 'product page shows allergens');
r = await req(null, 'GET', '/allergens/'); ok(/Contains Milk/.test(r.text), 'allergen table');

// ---------- basket ----------
const shop = new Jar();
r = await req(shop, 'POST', '/basket/', { form: { action: 'add', id: pid, qty: '3' }, origin: false, headers: { origin: 'https://evil.example' } }); ok(r.status === 403, 'cross-site basket blocked');
r = await req(shop, 'POST', '/basket/', { form: { action: 'add', id: draftId, qty: '1' } }); ok(r.status === 303 && !shop.c['__Host-basket'], 'draft cannot be added');
r = await req(shop, 'POST', '/basket/', { form: { action: 'add', id: pid, qty: '3' } }); ok(r.status === 303 && shop.c['__Host-basket'] === pid + '.3', 'added to basket');
r = await req(shop, 'POST', '/basket/', { form: { action: 'add', id: pid, qty: '9' } }); ok(shop.c['__Host-basket'] === pid + '.5', 'capped at max per order');
r = await req(shop, 'GET', '/basket/'); ok(/£92.50/.test(r.text), 'basket total');
r = await req(shop, 'POST', '/basket/', { form: { action: 'set', id: pid, qty: '2' } }); ok(shop.c['__Host-basket'] === pid + '.2', 'quantity updated');
shop.c['__Host-basket'] = pid + '.2|pdeadbeef0000.4'; r = await req(shop, 'GET', '/basket/'); ok(/no longer available/.test(r.text) && /£37/.test(r.text), 'unknown items dropped');
shop.c['__Host-basket'] = pid + '.2';

// ---------- checkout with Stripe ----------
r = await req(shop, 'GET', '/checkout/'); let t = tok(r.text); ok(t && /Continue to secure payment/.test(r.text) && /min="/.test(r.text), 'checkout page');
const co = { t, website: '', fulfilment: 'local', date_needed: future(2), name: 'Ana Test', email: 'ana@example.com', phone: '07700900456', address1: '2 Lane', town: 'Stoke', postcode: 'st11aa', allergens_ok: 'yes', terms_ok: 'yes' };
r = await req(shop, 'POST', '/checkout/', { form: co }); ok(r.status === 400 && /That was quick/.test(r.text), 'too-fast checkout');
await sleep(2100); t = tok(r.text); await sleep(2100);
r = await req(shop, 'POST', '/checkout/', { form: { ...co, t } }); ok(r.status === 400 && /earliest date/.test(r.text), 'notice period enforced');
t = tok(r.text); await sleep(2100);
r = await req(shop, 'POST', '/checkout/', { form: { ...co, t, date_needed: future(10), terms_ok: '' } }); ok(r.status === 400 && /terms of sale/.test(r.text), 'terms required');
t = tok(r.text); await sleep(2100);
r = await req(shop, 'POST', '/checkout/', { form: { ...co, t, date_needed: future(10) } }); ok(r.status === 303 && /^https:\/\/checkout\.stripe\.com/.test(r.loc), 'redirects to Stripe');
const sessions = JSON.parse(await T('sessions')); const s1 = sessions[sessions.length - 1];
ok(s1.amount_total === 3700 + 450 && s1.metadata.kind === 'order', 'Stripe total includes delivery and is priced on the server');
const calls = JSON.parse(await T('calls')); ok(calls.every(c => !/ana@example\.com.*sk_/.test(c.body)), 'no key in body');
let order = (await Q("SELECT * FROM orders"))[0]; ok(order.status === 'pending' && order.postcode === undefined && /ST1 1AA/.test(order.address), 'order pending with normalised postcode');
r = await req(shop, 'POST', '/checkout/', { form: { ...co, t, date_needed: future(10) } }); ok(r.status === 400 && /already sent/.test(r.text), 'form token single use');
const thanks = new URL(s1.success_url.replace('{CHECKOUT_SESSION_ID}', s1.id));
r = await req(shop, 'GET', thanks.pathname + thanks.search); ok(/Checking your payment/.test(r.text), 'unpaid session not marked paid');
await T('pay', { id: s1.id });
r = await req(shop, 'GET', thanks.pathname + thanks.search); ok(/Thank you for your order/.test(r.text) && r.text.includes(order.ref), 'paid order confirmed');
order = (await Q("SELECT * FROM orders"))[0]; ok(order.status === 'paid' && order.paid_at, 'order marked paid');
ok(!shop.c['__Host-basket'], 'basket cleared');
r = await req(null, 'GET', '/order/thanks/?o=' + order.id + '.' + 'a'.repeat(32)); ok(r.status === 303, 'forged order link refused');
let emails = JSON.parse(await T('emails')); ok(emails.some(e => e.to[0] === 'ana@example.com' && /Your order/.test(e.subject)) && emails.some(e => e.to[0] === 'hello@example.com' && /New paid order/.test(e.subject)), 'order emails sent');
r = await req(shop, 'GET', thanks.pathname + thanks.search); emails = JSON.parse(await T('emails')); ok(emails.filter(e => /New paid order/.test(e.subject)).length === 1, 'emails only once');

// ---------- webhook ----------
const whBody = s => JSON.stringify({ type: 'checkout.session.completed', data: { object: s } });
const sign = (body, secret = 'whsec_testsecret123', ts = Math.floor(Date.now() / 1000)) => `t=${ts},v1=` + crypto.createHmac('sha256', secret).update(ts + '.' + body).digest('hex');
r = await fetch(B + '/stripe/webhook', { method: 'POST', body: whBody({}), headers: { 'stripe-signature': sign(whBody({}), 'wrong') } }); ok(r.status === 400, 'webhook bad signature refused');
// second order paid only via webhook
shop.c['__Host-basket'] = pid + '.1';
r = await req(shop, 'GET', '/checkout/'); t = tok(r.text); await sleep(2100);
r = await req(shop, 'POST', '/checkout/', { form: { ...co, t, fulfilment: 'collect', date_needed: future(12), address1: '', town: '', postcode: '' } }); ok(r.status === 303, 'collect order to Stripe');
const s2 = JSON.parse(await T('sessions')).pop(); ok(s2.amount_total === 1850, 'collection is free');
const paidS2 = { ...s2, payment_status: 'paid' }; const b2 = whBody(paidS2);
r = await fetch(B + '/stripe/webhook', { method: 'POST', body: b2, headers: { 'stripe-signature': sign(b2) } }); ok(r.status === 200, 'webhook accepted');
ok((await Q('SELECT status FROM orders WHERE stripe_session = ?', [s2.id]))[0].status === 'paid', 'webhook marks paid');
const tampered = whBody({ ...paidS2, amount_total: 1 }); await T('x', { q: "UPDATE orders SET status = 'pending' WHERE stripe_session = ?", a: [s2.id] });
r = await fetch(B + '/stripe/webhook', { method: 'POST', body: tampered, headers: { 'stripe-signature': sign(tampered) } });
ok((await Q('SELECT status FROM orders WHERE stripe_session = ?', [s2.id]))[0].status === 'pending', 'wrong amount not accepted');
await T('x', { q: "UPDATE orders SET status = 'paid' WHERE stripe_session = ?", a: [s2.id] });

// ---------- enquiries into sections ----------
const pub = new Jar();
r = await req(pub, 'GET', '/weddings/'); t = tok(r.text); await sleep(3100);
r = await req(pub, 'POST', '/enquire/', { form: { t, source: 'weddings', website: '', name: 'Bea <b>Bride</b>', email: 'BEA@example.com', occasion: 'Wedding', event_date: future(200), quantity: '80 guests', venue: 'The Hall', message: 'Favours for 80 guests please', allergies: 'nut allergy' } });
ok(r.status === 303 && /\/enquire\/thanks\//.test(r.loc), 'wedding enquiry sent');
r = await req(pub, 'GET', '/contact/'); t = tok(r.text); await sleep(3100);
r = await req(pub, 'POST', '/enquire/', { form: { t, source: 'contact', website: 'http://spam', name: 'Spam', email: 's@x.com', message: 'buy now' } }); ok(r.status === 303, 'honeypot silently dropped');
r = await req(pub, 'GET', '/bespoke/'); t = tok(r.text); await sleep(3100);
r = await req(pub, 'POST', '/enquire/', { form: { t, source: 'bespoke', website: '', name: 'Cal Corp', email: 'cal@example.com', occasion: 'Corporate gifts or an event', message: '50 boxes with our logo' } }); ok(r.status === 303, 'corporate enquiry sent');
const msgs = await Q('SELECT * FROM messages ORDER BY created'); ok(msgs.length === 2 && msgs[0].section === 'wedding' && msgs[1].section === 'corporate' && msgs[0].email === 'bea@example.com', 'messages sorted into sections');
r = await req(adm, 'GET', '/admin/api/messages?section=wedding&status=open'); ok(r.data.messages.length === 1 && r.data.counts.find(c => c.section === 'wedding').unread === 1, 'admin wedding folder');
const mid = r.data.messages[0].id;
r = await req(adm, 'GET', '/admin/api/messages/' + mid); ok(r.data.message.allergies === 'nut allergy' && r.data.message.name === 'Bea <b>Bride</b>', 'message detail (raw text, shown with textContent)');
r = await req(adm, 'GET', '/admin/api/messages?section=wedding'); ok(r.data.messages[0].unread === 0, 'opened message marked read');
r = await req(adm, 'PATCH', '/admin/api/messages/' + mid, { json: { section: 'nonsense' } }); ok(r.status === 400, 'bad section refused');
r = await req(adm, 'PATCH', '/admin/api/messages/' + mid, { json: { section: 'bespoke', notes: 'Wants ivory ribbon' } }); ok(r.status === 200, 'moved section + notes');
ok((await Q('SELECT section, notes FROM messages WHERE id = ?', [mid]))[0].section === 'bespoke', 'section changed');

// ---------- quote payment link ----------
r = await req(adm, 'POST', '/admin/api/messages/' + mid + '/link', { json: { amount: '120', description: 'Deposit for 80 wedding favours', days: 14, send: true } }); ok(r.status === 200 && /\/pay\/[a-z0-9]+\.[a-f0-9]{48}\/$/.test(r.data.link) && r.data.emailed, 'payment link made and emailed');
const link = new URL(r.data.link); ok((await Q('SELECT status FROM messages WHERE id = ?', [mid]))[0].status === 'quoted', 'message marked quoted');
const payRow = (await Q('SELECT * FROM payments'))[0]; ok(!link.pathname.includes(payRow.secret), 'link secret stored hashed');
r = await req(null, 'GET', link.pathname.replace(/\.[a-f0-9]{48}/, '.' + 'b'.repeat(48))); ok(r.status === 404, 'wrong link secret 404');
r = await req(pub, 'GET', link.pathname); ok(/£120/.test(r.text) && /Deposit for 80 wedding favours/.test(r.text), 'pay page');
t = tok(r.text);
r = await req(pub, 'POST', link.pathname, { form: { t } }); ok(r.status === 303 && /checkout\.stripe\.com/.test(r.loc), 'pay link goes to Stripe');
const s3 = JSON.parse(await T('sessions')).pop(); ok(s3.amount_total === 12000 && s3.metadata.kind === 'link', 'quote amount right');
await T('pay', { id: s3.id });
r = await req(pub, 'GET', link.pathname + '?session_id=' + s3.id); ok(/This was paid/.test(r.text), 'quote paid');
ok((await Q('SELECT status FROM messages WHERE id = ?', [mid]))[0].status === 'paid', 'message marked paid');
r = await req(adm, 'GET', '/admin/api/dashboard'); ok(r.data.month.quotes === 12000 && r.data.month.orders === 3700 + 450 + 1850, 'dashboard totals');

// ---------- orders admin ----------
r = await req(adm, 'GET', '/admin/api/orders'); ok(r.data.orders.length === 2, 'orders list');
const oid = r.data.orders[0].id;
r = await req(adm, 'PATCH', '/admin/api/orders/' + oid, { json: { status: 'ready', notify: true } }); ok(r.status === 200, 'order marked ready');
emails = JSON.parse(await T('emails')); ok(emails.some(e => /is ready/.test(e.subject)), 'ready email');
r = await req(adm, 'DELETE', '/admin/api/orders/' + oid); ok(r.status === 400, 'paid orders cannot be deleted');

// ---------- photos ----------
const tiny = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]).toString('base64');
r = await req(adm, 'POST', '/admin/api/photos', { json: { data: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' } }); ok(r.status === 400, 'svg refused');
r = await req(adm, 'POST', '/admin/api/photos', { json: { data: 'data:image/jpeg;base64,' + Buffer.from('<html>').toString('base64') } }); ok(r.status === 400, 'fake jpeg refused');
r = await req(adm, 'POST', '/admin/api/photos', { json: { data: tiny, w: 1, h: 1 } }); ok(r.status === 200, 'photo uploaded');
const ph = await fetch(B + r.data.url); ok(ph.status === 200 && ph.headers.get('content-type') === 'image/jpeg' && ph.headers.get('x-content-type-options') === 'nosniff', 'photo served');
r = await req(adm, 'POST', '/admin/api/gallery', { json: { photo: r.data.id, caption: 'Our favours' } }); ok(r.status === 200, 'gallery add');
r = await req(null, 'GET', '/gallery/'); ok(/Our favours/.test(r.text), 'gallery shows');

// ---------- journal ----------
r = await req(adm, 'POST', '/admin/api/posts', { json: { title: 'New autumn flavours', summary: 'Spiced and warm', body: 'Para one.\n\n## A heading\n\n<img src=x onerror=alert(1)>', published: true } }); ok(r.status === 200, 'post created');
r = await req(null, 'GET', '/journal/' + r.data.slug + '/'); ok(/<h2>A heading<\/h2>/.test(r.text) && /&lt;img src=x/.test(r.text), 'post renders safely');
r = await req(null, 'GET', '/'); ok(/href="\/journal\/"/.test(r.text), 'journal link appears');

// ---------- no stripe: order requests ----------
await T('env', { STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '' });
const req2 = new Jar(); req2.c['__Host-basket'] = pid + '.1';
r = await req(req2, 'GET', '/checkout/'); ok(/Send my order request/.test(r.text), 'request mode without Stripe'); t = tok(r.text); await sleep(2100);
r = await req(req2, 'POST', '/checkout/', { form: { ...co, t, fulfilment: 'collect', date_needed: future(9) } }); ok(r.status === 303 && /\/order\/requested\//.test(r.loc), 'order request sent');
r = await req(req2, 'GET', r.loc); ok(/Order request sent/.test(r.text), 'request confirmation');
await T('env', { STRIPE_SECRET_KEY: 'sk_test_abc123XYZ', STRIPE_WEBHOOK_SECRET: 'whsec_testsecret123' });
const rq = (await Q("SELECT id FROM orders WHERE status = 'requested'"))[0];
r = await req(adm, 'POST', '/admin/api/orders/' + rq.id + '/link', { json: { send: false } }); ok(r.status === 200 && /\/pay\//.test(r.data.link), 'order payment link');

// ---------- privacy + housekeeping ----------
r = await req(adm, 'GET', '/admin/api/export?email=bea@example.com'); ok(r.data.messages.length === 1, 'subject access export');
await T('x', { q: "UPDATE messages SET created = 1 WHERE section = 'corporate'" });
await T('x', { q: "INSERT INTO orders (id, ref, created, status, name, email, fulfilment, items, subtotal, total, updated) VALUES ('o00000000000000000000', 'CH-OLD', 1, 'pending', 'x', 'x@x.com', 'collect', '[]', 0, 0, 1)" });
await T('cron');
ok((await Q("SELECT COUNT(*) AS n FROM messages WHERE section = 'corporate'"))[0].n === 0, 'old enquiry deleted');
ok((await Q("SELECT COUNT(*) AS n FROM orders WHERE ref = 'CH-OLD'"))[0].n === 0, 'old unpaid checkout deleted');
ok((await Q("SELECT COUNT(*) AS n FROM messages"))[0].n === 1, 'paid enquiry kept');
r = await req(adm, 'POST', '/admin/api/logout', { json: {} }); r = await req(adm, 'GET', '/admin/api/dashboard'); ok(r.status === 401, 'logout ends session');
r = await req(null, 'GET', '/robots.txt'); ok(/Disallow: \/admin\//.test(r.text), 'robots');
r = await req(null, 'GET', '/sitemap.xml'); ok(r.text.includes('/shop/' + slug + '/'), 'sitemap');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
