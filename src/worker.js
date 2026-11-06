// Custom chocolates: shop, bespoke orders, payments and a private admin, on Cloudflare Workers + D1.
//
// No passwords, keys or tokens live in this code or reach any browser.
//   DB                     D1 database binding (everything is stored here)
//   SETUP_CODE             secret (optional): a phrase used once at /admin/ to create the first login.
//                          Instead of the secret, a one-time code can be put in the database as a SHA-256 hash (settings key 'setup_code_hash').
//   STRIPE_SECRET_KEY      secret (optional): turns on card payments (Stripe Checkout)
//   STRIPE_WEBHOOK_SECRET  secret (optional): signing secret for https://<site>/stripe/webhook (event: checkout.session.completed)
//   RESEND_API_KEY, EMAIL_FROM  secrets (optional): order and enquiry emails through resend.com
import { esc, json, html, redirect, secure, sameOrigin, readForm, clean, line, EMAIL_RE, normPhone, normPostcode, randomHex, sha256hex, hmacHex, secretKey, safeEqual, formToken, checkToken, limit, todayUK, addDays, isoDate, money, niceDate } from './lib.js';
import { ensureDb, getContent, publicProducts, productRow, hasPosts, OCCASIONS, STOCK, safeArr } from './db.js';
import * as P from './pages.js';
import { stripeReady, createCheckout, getCheckout, verifyWebhook } from './stripe.js';
import { sendEmail } from './email.js';
import { adminRoute, ADMIN_HEADERS } from './admin.js';

const BASKET = '__Host-basket';

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    try {
      if (!env.DB) return new Response('The database is not connected yet.', { status: 503 });
      await ensureDb(env);
      return await route(req, env, ctx, url);
    } catch (e) {
      console.error(e && e.stack || e);
      if (url.pathname.startsWith('/admin/api/')) return json({ error: 'Something went wrong on our side. Please try again.' }, 500);
      const c = await getContent(env).catch(() => ({ name: 'Handmade Chocolates', heroText: '', contact: {}, legal: {} }));
      return html(P.layout(c, { title: 'Something went wrong', body: P.errorPage() }), url, { status: 500 });
    }
  },
  async scheduled(event, env, ctx) {
    if (!env.DB) return;
    await ensureDb(env);
    ctx.waitUntil(tidy(env));
  }
};

/* ---------- daily tidy-up: data is kept only as long as the privacy notice says ---------- */
export async function tidy(env) {
  const c = await getContent(env, true), now = Date.now(), day = 86400000;
  const months = Math.min(Math.max(Number(c.keepMessagesMonths) || 24, 1), 72);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE exp < ?').bind(now),
    env.DB.prepare('DELETE FROM ratelimit WHERE exp < ?').bind(now),
    env.DB.prepare("DELETE FROM orders WHERE status = 'pending' AND created < ?").bind(now - 7 * day),
    env.DB.prepare("DELETE FROM messages WHERE created < ? AND status NOT IN ('booked', 'paid')").bind(now - months * 30 * day),
    env.DB.prepare('DELETE FROM messages WHERE created < ?').bind(now - 6 * 365 * day),
    env.DB.prepare('DELETE FROM orders WHERE created < ?').bind(now - 6 * 365 * day),
    env.DB.prepare('DELETE FROM payments WHERE created < ?').bind(now - 6 * 365 * day),
    env.DB.prepare("UPDATE payments SET status = 'expired' WHERE status = 'open' AND expires < ?").bind(now),
    env.DB.prepare('DELETE FROM log WHERE at < ?').bind(now - 365 * day),
    env.DB.prepare('DELETE FROM hits WHERE day < ?').bind(addDays(todayUK(), -400)),
    env.DB.prepare("DELETE FROM photos WHERE created < ? AND id NOT IN (SELECT photo FROM products UNION SELECT photo FROM gallery UNION SELECT photo FROM posts) AND instr((SELECT value FROM settings WHERE key = 'content'), id) = 0").bind(now - day)
  ]);
}

async function route(req, env, ctx, url) {
  const p = url.pathname, m = req.method === 'HEAD' ? 'GET' : req.method;

  // admin (separate, strict security policy; nothing public is mixed in)
  if (p === '/admin' ) return redirect('/admin/', 301);
  if (p.startsWith('/admin/')) {
    const r = await adminRoute(req, env, ctx, url);
    if (r) return r;
    const a = await env.ASSETS.fetch(req);
    const out = secure(a, url, ADMIN_HEADERS.csp);
    out.headers.set('X-Robots-Tag', 'noindex, nofollow');
    out.headers.set('Cache-Control', 'no-store');
    return out;
  }
  if (p === '/stripe/webhook' && m === 'POST') return webhook(req, env, ctx);
  if (p.startsWith('/assets/')) { const a = await env.ASSETS.fetch(req); const out = secure(a, url); if (a.ok) out.headers.set('Cache-Control', 'public, max-age=86400'); return out; }
  if (p.startsWith('/photos/')) return photo(req, env, ctx, url);
  if (p === '/robots.txt') return new Response(`User-agent: *\nDisallow: /admin/\nDisallow: /basket/\nDisallow: /checkout/\nDisallow: /pay/\nDisallow: /order/\nSitemap: ${url.origin}/sitemap.xml\n`, { headers: { 'Content-Type': 'text/plain' } });
  if (p === '/sitemap.xml') return sitemap(env, url);
  if (p === '/favicon.ico') return redirect('/assets/favicon.svg', 301);
  if (!p.endsWith('/') && !p.includes('.')) return redirect(p + '/' + url.search, 301);

  const c = await getContent(env);
  const basket = readBasket(req);
  const page = async (title, body, opts = {}) => {
    if (m === 'GET' && !opts.noCount) ctx.waitUntil(countHit(env, req, p).catch(() => {}));
    return html(P.layout(c, { title, body, path: p, basketCount: basket.reduce((s, b) => s + b.qty, 0), journal: await hasPosts(env), desc: opts.desc, noindex: opts.noindex }), url, { status: opts.status || 200, cookies: opts.cookies || [], noindex: opts.noindex });
  };

  if (p === '/' && m === 'GET') {
    const [products, posts] = await Promise.all([publicProducts(env), env.DB.prepare('SELECT slug, title, summary, photo, created FROM posts WHERE published = 1 ORDER BY created DESC LIMIT 2').all()]);
    return page('', P.homePage(c, { products: c.shopOpen ? products : [], token: await formToken(env), posts: posts.results }));
  }
  if (p === '/shop/' && m === 'GET') return page('Shop', P.shopPage(c, { products: await publicProducts(env), cat: clean(url.searchParams.get('c'), 40) }), { desc: 'Handmade chocolates to order online, made fresh for your date.' });
  const sp = /^\/shop\/([a-z0-9-]{1,60})\/$/.exec(p);
  if (sp && m === 'GET') {
    const prod = productRow(await env.DB.prepare('SELECT * FROM products WHERE slug = ? AND published = 1 AND price > 0 AND allergens_checked = 1').bind(sp[1]).first());
    if (!prod) return page('Page not found', P.notFound(), { status: 404 });
    return page(prod.name, P.productPage(c, prod, { added: url.searchParams.get('added') === '1' }), { desc: prod.summary || prod.name });
  }
  if (p === '/basket/') {
    if (m === 'POST') return basketPost(req, env, url, c, basket);
    const { lines, subtotal, problems } = await priceBasket(env, basket, c);
    return page('Your basket', P.basketPage(c, { lines, subtotal, problems }), { noindex: true, noCount: true });
  }
  if (p === '/checkout/') return checkout(req, env, ctx, url, c, basket, page);
  if (p === '/order/thanks/' && m === 'GET') return orderThanks(req, env, ctx, url, c, page);
  if (p === '/order/requested/' && m === 'GET') {
    const o = await findOrderByToken(env, url.searchParams.get('o'));
    if (!o) return redirect('/');
    return page('Order request sent', P.orderDonePage(c, o, { requested: true }), { noindex: true, noCount: true });
  }
  if (p === '/enquire/' && m === 'POST') return enquire(req, env, ctx, url, c, page);
  if (p === '/enquire/thanks/' && m === 'GET') return page('Thank you', P.enquiryDonePage(c, { name: clean(url.searchParams.get('n'), 40) }), { noindex: true, noCount: true });
  if (p === '/bespoke/' && m === 'GET') return page('Bespoke chocolates', P.bespokePage(c, { token: await formToken(env), values: {}, errors: [] }), { desc: c.bespokeText });
  if (p === '/weddings/' && m === 'GET') return page('Wedding favours', P.weddingsPage(c, { token: await formToken(env), values: {}, errors: [] }), { desc: c.weddingsText });
  if (p === '/gallery/' && m === 'GET') { const { results } = await env.DB.prepare('SELECT * FROM gallery ORDER BY sort, created').all(); return page('Gallery', P.galleryPage(c, results)); }
  if (p === '/journal/' && m === 'GET') { const { results } = await env.DB.prepare('SELECT slug, title, summary, photo, created FROM posts WHERE published = 1 ORDER BY created DESC').all(); if (!results.length) return page('Page not found', P.notFound(), { status: 404 }); return page('Journal', P.journalPage(c, results)); }
  const jp = /^\/journal\/([a-z0-9-]{1,60})\/$/.exec(p);
  if (jp && m === 'GET') { const post = await env.DB.prepare('SELECT * FROM posts WHERE slug = ? AND published = 1').bind(jp[1]).first(); if (!post) return page('Page not found', P.notFound(), { status: 404 }); return page(post.title, P.postPage(c, post), { desc: post.summary }); }
  if (p === '/allergens/' && m === 'GET') return page('Allergen information', P.allergensPage(c, await publicProducts(env)));
  if (p === '/delivery/' && m === 'GET') return page('Delivery and collection', P.deliveryPage(c));
  if (p === '/faq/' && m === 'GET') return page('Questions', P.faqPage(c));
  if (p === '/contact/' && m === 'GET') return page('Contact', P.contactPage(c, { token: await formToken(env), values: {}, errors: [] }));
  if (p === '/privacy/' && m === 'GET') return page('Privacy notice', P.privacyPage(c));
  if (p === '/terms/' && m === 'GET') return page('Terms of sale', P.termsPage(c));
  const pay = /^\/pay\/([a-z0-9]{8,24})\.([a-f0-9]{48})\/$/.exec(p);
  if (pay) return payLink(req, env, ctx, url, c, page, pay[1], pay[2]);
  if (m !== 'GET' && m !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  return page('Page not found', P.notFound(), { status: 404, noCount: true });
}

/* ---------- photos: uploads from the database, stand-ins fetched once and cached ---------- */
async function photo(req, env, ctx, url) {
  const st = /^\/photos\/stock\/([a-z]+)\.jpg$/.exec(url.pathname);
  if (st && STOCK[st[1]]) {
    const cache = caches.default, key = new Request(url.origin + url.pathname);
    let res = await cache.match(key);
    if (!res) {
      const r = await fetch(STOCK[st[1]].src, { headers: { 'User-Agent': 'HandmadeChocolatesSite/1.0 (website image cache)' }, cf: { cacheTtl: 2592000, cacheEverything: true } });
      if (!r.ok) return new Response('Not found', { status: 404 });
      res = new Response(r.body, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=2592000' } });
      ctx.waitUntil(cache.put(key, res.clone()));
    }
    return secure(res, url);
  }
  const m = /^\/photos\/([a-z0-9]{8,40})\.jpg$/.exec(url.pathname);
  if (!m) return new Response('Not found', { status: 404 });
  const row = await env.DB.prepare('SELECT data, type FROM photos WHERE id = ?').bind(m[1]).first();
  if (!row) return new Response('Not found', { status: 404 });
  return secure(new Response(row.data instanceof ArrayBuffer || ArrayBuffer.isView(row.data) ? row.data : new Uint8Array(row.data), { headers: { 'Content-Type': row.type === 'image/webp' ? 'image/webp' : 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' } }), url);
}

/* ---------- visit counts: no cookies, no IP addresses, nothing that identifies a person ---------- */
async function countHit(env, req, path) {
  const ua = req.headers.get('user-agent') || '';
  if (/bot|crawl|spider|preview|headless|monitor|curl|wget/i.test(ua) || !ua) return;
  let ref = '';
  try { const r = new URL(req.headers.get('referer') || ''); if (r.host && r.host !== new URL(req.url).host) ref = r.hostname.replace(/^www\./, '').slice(0, 60); } catch {}
  await env.DB.prepare('INSERT INTO hits (day, path, ref, n) VALUES (?, ?, ?, 1) ON CONFLICT(day, path, ref) DO UPDATE SET n = n + 1').bind(todayUK(), path.slice(0, 100), ref).run();
}

async function sitemap(env, url) {
  const [prods, posts] = await Promise.all([publicProducts(env), env.DB.prepare('SELECT slug FROM posts WHERE published = 1').all()]);
  const paths = ['/', '/shop/', '/bespoke/', '/weddings/', '/gallery/', '/allergens/', '/delivery/', '/faq/', '/contact/', '/privacy/', '/terms/', ...prods.map(p => '/shop/' + p.slug + '/'), ...(posts.results.length ? ['/journal/'] : []), ...posts.results.map(p => '/journal/' + p.slug + '/')];
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(x => `<url><loc>${esc(url.origin + x)}</loc></url>`).join('')}</urlset>`, { headers: { 'Content-Type': 'application/xml' } });
}

/* ---------- basket (one strictly-necessary cookie holding product ids and quantities) ---------- */
function readBasket(req) {
  const raw = (req.headers.get('cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(BASKET + '='));
  if (!raw) return [];
  return raw.slice(BASKET.length + 1).split('|').map(x => /^(p[a-f0-9]{12})\.(\d{1,2})$/.exec(x)).filter(Boolean).map(x => ({ id: x[1], qty: Math.min(Number(x[2]), 50) })).filter(b => b.qty > 0).slice(0, 20);
}
const basketCookie = b => b.length ? `${BASKET}=${b.map(x => x.id + '.' + x.qty).join('|')}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${7 * 86400}` : `${BASKET}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
async function priceBasket(env, basket, c) {
  if (!basket.length) return { lines: [], subtotal: 0, problems: [], notice: c.noticeDays };
  const ids = basket.map(b => b.id);
  const { results } = await env.DB.prepare(`SELECT * FROM products WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
  const byId = Object.fromEntries(results.map(r => [r.id, productRow(r)]));
  const lines = [], problems = [];
  for (const b of basket) {
    const p = byId[b.id];
    if (!p || !p.published || !(p.price > 0) || !p.allergens_checked) { problems.push('Something in your basket is no longer available, so it was removed.'); continue; }
    if (p.sold_out) { problems.push(p.name + ' has sold out, so it was removed.'); continue; }
    const qty = Math.min(b.qty, p.max_qty || 20);
    if (qty < b.qty) problems.push(`You can order up to ${p.max_qty} of ${p.name} online. For more, send a bespoke enquiry.`);
    lines.push({ p, qty });
  }
  return { lines, subtotal: lines.reduce((s, l) => s + l.p.price * l.qty, 0), problems, notice: Math.max(c.noticeDays, ...lines.map(l => l.p.notice_days || 0)) };
}
async function basketPost(req, env, url, c, basket) {
  if (!sameOrigin(req, url)) return new Response('Request blocked for security reasons.', { status: 403 });
  const f = await readForm(req); if (!f) return redirect('/basket/');
  const id = /^p[a-f0-9]{12}$/.test(f.id || '') ? f.id : '';
  const qty = Math.max(0, Math.min(50, parseInt(f.qty, 10) || 0));
  let b = basket.filter(x => x.id !== id);
  if (id && f.action === 'add') {
    const prod = await env.DB.prepare('SELECT slug, max_qty FROM products WHERE id = ? AND published = 1 AND sold_out = 0 AND price > 0 AND allergens_checked = 1').bind(id).first();
    if (!prod || !c.shopOpen) return redirect('/shop/');
    const had = basket.find(x => x.id === id);
    b.push({ id, qty: Math.min((had ? had.qty : 0) + Math.max(1, qty), prod.max_qty || 20) });
    if (b.length > 20) b = b.slice(-20);
    const back = f.back === 'basket' ? '/basket/' : '/shop/' + prod.slug + '/?added=1';
    return redirect(back, 303, [basketCookie(b)]);
  }
  if (id && f.action === 'set' && qty > 0) { const old = basket.find(x => x.id === id); if (old) b = basket.map(x => x.id === id ? { id, qty } : x); }
  return redirect('/basket/', 303, [basketCookie(b)]);
}

/* ---------- checkout ---------- */
async function checkout(req, env, ctx, url, c, basket, page) {
  const priced = await priceBasket(env, basket, c);
  if (!c.shopOpen || !priced.lines.length) return redirect('/basket/');
  const minDate = addDays(todayUK(), priced.notice);
  const payReady = stripeReady(env);
  const render = async (values, errors, status = 200) => page('Checkout', P.checkoutPage(c, { lines: priced.lines, subtotal: priced.subtotal, minDate, values, errors, token: await formToken(env), payReady, cancelled: url.searchParams.get('cancelled') === '1' }), { noindex: true, noCount: true, status });
  if (req.method === 'GET') return render({}, []);
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!sameOrigin(req, url)) return new Response('Request blocked for security reasons.', { status: 403 });
  const f = await readForm(req); if (!f) return render({}, ['Please try again.'], 400);
  const rl = await limit(env, req, 'checkout', 12, 3600);
  if (rl.blocked) return render(f, ['Too many attempts. Please wait a while and try again.'], 429);
  const v = {
    fulfilment: ['collect', 'local', 'post'].includes(f.fulfilment) ? f.fulfilment : '', date_needed: isoDate(f.date_needed),
    name: line(f.name, 80), email: line(f.email, 120).toLowerCase(), phone: normPhone(f.phone),
    address1: line(f.address1, 100), address2: line(f.address2, 100), town: line(f.town, 60), postcode: normPostcode(f.postcode),
    gift_message: clean(f.gift_message, 300), notes: clean(f.notes, 1000), allergens_ok: f.allergens_ok === 'yes', terms_ok: f.terms_ok === 'yes'
  };
  const errors = [];
  if (f.website) return redirect('/');
  const tk = await checkToken(env, f.t, 2000);
  if (tk === 'fast') errors.push('That was quick. Please check your details and press the button again.');
  else if (tk === 'used') errors.push('This form was already sent. Please check your email, or press the button again.');
  else if (tk !== 'ok') errors.push('The form expired. Please press the button again.');
  const opt = v.fulfilment && c.delivery[v.fulfilment];
  if (!opt || !opt.on) errors.push('Choose collection or delivery.');
  if (!v.date_needed) errors.push('Choose the date you need your order.');
  else if (v.date_needed < minDate) errors.push(`The earliest date is ${niceDate(minDate)}.`);
  else if (v.date_needed > addDays(todayUK(), 365)) errors.push('Choose a date within the next year.');
  if (v.name.length < 2) errors.push('Enter your name.');
  if (!EMAIL_RE.test(v.email)) errors.push('Enter a valid email address.');
  if (!v.phone) errors.push('Enter a UK phone number, in case there is a question about your order.');
  if (v.fulfilment && v.fulfilment !== 'collect' && (!v.address1 || !v.town || !v.postcode)) errors.push('Enter the delivery address, including a valid UK postcode.');
  if (!v.allergens_ok) errors.push('Please confirm you have read the allergen information.');
  if (!v.terms_ok) errors.push('Please agree to the terms of sale.');
  if (errors.length) { await rl.hit(); return render({ ...f, ...v, phone: f.phone, postcode: f.postcode }, errors, 400); }

  const fee = Math.max(0, Math.round(Number(opt.fee) || 0));
  const items = priced.lines.map(l => ({ id: l.p.id, name: l.p.name, price: l.p.price, qty: l.qty }));
  const id = 'o' + randomHex(10), ref = refCode(), now = Date.now();
  const status = stripeReady(env) ? 'pending' : 'requested';
  const address = v.fulfilment === 'collect' ? '' : [v.address1, v.address2, v.town, v.postcode].filter(Boolean).join(', ');
  await env.DB.prepare('INSERT INTO orders (id, ref, created, status, name, email, phone, fulfilment, address, date_needed, items, subtotal, delivery_fee, total, gift_message, notes, updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id, ref, now, status, v.name, v.email, v.phone, v.fulfilment, address, v.date_needed, JSON.stringify(items), priced.subtotal, fee, priced.subtotal + fee, v.gift_message, v.notes, now).run();
  const viewTok = await orderToken(env, id);

  if (status === 'requested') {
    ctx.waitUntil(orderEmails(env, c, url, { ...(await getOrder(env, id)) }, 'requested'));
    return redirect('/order/requested/?o=' + viewTok, 303, [basketCookie([])]);
  }
  const lines = items.map(i => ({ name: i.name, unit: i.price, qty: i.qty }));
  if (fee) lines.push({ name: { collect: 'Collection', local: 'Local delivery', post: 'UK delivery' }[v.fulfilment], unit: fee, qty: 1 });
  try {
    const s = await createCheckout(env, { origin: url.origin, lines, email: v.email, kind: 'order', id, successPath: '/order/thanks/?o=' + viewTok, cancelPath: '/checkout/?cancelled=1', shopName: c.name, description: 'order ' + ref });
    await env.DB.prepare('UPDATE orders SET stripe_session = ? WHERE id = ?').bind(s.id, id).run();
    return redirect(s.url);
  } catch (e) {
    console.error('stripe checkout failed', e.message);
    await env.DB.prepare('DELETE FROM orders WHERE id = ?').bind(id).run();
    return render(v, ['Payments are not working right now, so nothing has been charged. Please try again in a few minutes.'], 502);
  }
}
const refCode = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', b = crypto.getRandomValues(new Uint8Array(6)); return 'CH-' + [...b].map(x => a[x % a.length]).join(''); };
// a signed, unguessable link for viewing one order's confirmation (the order id alone is not enough)
async function orderToken(env, id) { return id + '.' + (await hmacHex(await secretKey(env, 'orderkey'), id)).slice(0, 32); }
async function findOrderByToken(env, tok) {
  const m = /^(o[a-f0-9]{20})\.([a-f0-9]{32})$/.exec(String(tok || ''));
  if (!m) return null;
  if (!(await safeEqual(await orderToken(env, m[1]), tok))) return null;
  return getOrder(env, m[1]);
}
export async function getOrder(env, id) { const o = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first(); return o && { ...o, items: safeArr(o.items) }; }

async function orderThanks(req, env, ctx, url, c, page) {
  const o = await findOrderByToken(env, url.searchParams.get('o'));
  if (!o) return redirect('/');
  if (o.status === 'pending' && stripeReady(env)) {
    try {
      const s = await getCheckout(env, url.searchParams.get('session_id'));
      if (s.id === o.stripe_session && s.payment_status === 'paid' && s.metadata && s.metadata.id === o.id && s.amount_total === o.total) await markOrderPaid(env, ctx, c, url, o);
    } catch (e) { console.error('checkout check failed', e.message); }
  }
  const fresh = await getOrder(env, o.id);
  if (fresh.status === 'pending') return page('Checking your payment', `<section class="head"><div class="container head__in"><h1>Checking your payment</h1><p class="lead muted">If you completed payment, your confirmation email is on its way. You can refresh this page in a moment.</p><p>Order reference <strong>${esc(fresh.ref)}</strong></p></div></section>`, { noindex: true, noCount: true });
  return page('Thank you', P.orderDonePage(c, fresh, { requested: fresh.status === 'requested' }), { noindex: true, noCount: true, cookies: [basketCookie([])] });
}
async function markOrderPaid(env, ctx, c, url, o) {
  const r = await env.DB.prepare("UPDATE orders SET status = 'paid', paid_at = ?, updated = ? WHERE id = ? AND status IN ('pending', 'requested')").bind(Date.now(), Date.now(), o.id).run();
  if (r.meta && r.meta.changes) ctx.waitUntil(orderEmails(env, c, url, await getOrder(env, o.id), 'paid'));
}

async function orderEmails(env, c, url, o, kind) {
  const lines = o.items.map(i => `${i.qty} x ${i.name}  ${money(i.price * i.qty)}`).join('\n');
  const how = o.fulfilment === 'collect' ? 'Collection' : 'Delivery to ' + o.address;
  const summary = `Order ${o.ref}\n\n${lines}\n${o.delivery_fee ? 'Delivery  ' + money(o.delivery_fee) + '\n' : ''}Total  ${money(o.total)}\n\n${how}\nDate needed: ${niceDate(o.date_needed)}${o.gift_message ? '\nGift message: ' + o.gift_message : ''}${o.notes ? '\nNotes: ' + o.notes : ''}`;
  const to = c.alertEmail || c.contact.email;
  if (to) await sendEmail(env, { to, subject: (kind === 'paid' ? 'New paid order ' : 'New order request ') + o.ref, text: `${summary}\n\nCustomer: ${o.name}, ${o.email}, ${o.phone}\n\nOpen your admin: ${url.origin}/admin/` });
  await sendEmail(env, { to: o.email, subject: (kind === 'paid' ? 'Your order ' : 'Your order request ') + o.ref + ' from ' + c.name, text: `Hello ${o.name.split(' ')[0]},\n\n${kind === 'paid' ? 'Thank you for your order. Your payment went through and your order is booked in.' : 'Thank you for your order request. You will get a reply to confirm your date, with a secure link to pay.'}\n\n${summary}\n\nIf anything needs changing, just reply to this email.\n\n${c.name}` });
}

/* ---------- Stripe webhook: the reliable way payments are recorded ---------- */
async function webhook(req, env, ctx) {
  const body = await req.text();
  if (body.length > 256 * 1024 || !(await verifyWebhook(env, body, req.headers.get('stripe-signature')))) return new Response('Invalid signature', { status: 400 });
  let ev; try { ev = JSON.parse(body); } catch { return new Response('Bad body', { status: 400 }); }
  if (ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') {
    const s = ev.data && ev.data.object;
    if (s && s.payment_status === 'paid' && s.metadata) {
      const c = await getContent(env), url = new URL(req.url);
      if (s.metadata.kind === 'order') { const o = await getOrder(env, s.metadata.id); if (o && o.stripe_session === s.id && s.amount_total === o.total) await markOrderPaid(env, ctx, c, url, o); }
      if (s.metadata.kind === 'link') await markLinkPaid(env, ctx, c, url, s.metadata.id, s);
    }
  }
  return json({ received: true });
}

/* ---------- payment links sent from the admin (bespoke quotes, deposits, order requests) ---------- */
async function payLink(req, env, ctx, url, c, page, id, secret) {
  const row = await env.DB.prepare('SELECT * FROM payments WHERE id = ?').bind(id).first();
  if (!row || !(await safeEqual(await sha256hex(secret), row.secret))) return page('Page not found', P.notFound(), { status: 404, noCount: true });
  const payReady = stripeReady(env);
  if (req.method === 'GET') {
    if (row.status === 'open' && url.searchParams.get('session_id') && payReady) {
      try { const s = await getCheckout(env, url.searchParams.get('session_id')); if (s.id === row.stripe_session && s.payment_status === 'paid' && s.amount_total === row.amount) await markLinkPaid(env, ctx, c, url, row.id, s); } catch (e) { console.error(e.message); }
    }
    const fresh = await env.DB.prepare('SELECT * FROM payments WHERE id = ?').bind(id).first();
    return page('Secure payment', P.payPage(c, fresh, { cancelled: url.searchParams.get('cancelled') === '1', payReady, token: await formToken(env) }), { noindex: true, noCount: true });
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!sameOrigin(req, url)) return new Response('Request blocked for security reasons.', { status: 403 });
  if (row.status !== 'open' || row.expires < Date.now() || !payReady) return redirect(url.pathname);
  const rl = await limit(env, req, 'pay', 20, 3600); if (rl.blocked) return redirect(url.pathname); await rl.hit();
  try {
    const s = await createCheckout(env, { origin: url.origin, lines: [{ name: row.description, unit: row.amount, qty: 1 }], email: row.email, kind: 'link', id: row.id, successPath: url.pathname, cancelPath: url.pathname + '?cancelled=1', shopName: c.name, description: row.description });
    await env.DB.prepare('UPDATE payments SET stripe_session = ? WHERE id = ?').bind(s.id, row.id).run();
    return redirect(s.url);
  } catch (e) { console.error('pay link checkout failed', e.message); return page('Secure payment', P.errorPage('Payments are not working right now, so nothing has been charged. Please try again in a few minutes.'), { status: 502, noindex: true }); }
}
async function markLinkPaid(env, ctx, c, url, id, s) {
  const row = await env.DB.prepare('SELECT * FROM payments WHERE id = ?').bind(id).first();
  if (!row || row.stripe_session !== s.id || s.amount_total !== row.amount) return;
  const r = await env.DB.prepare("UPDATE payments SET status = 'paid', paid_at = ? WHERE id = ? AND status = 'open'").bind(Date.now(), id).run();
  if (!(r.meta && r.meta.changes)) return;
  if (row.kind === 'message') await env.DB.prepare("UPDATE messages SET status = 'paid', updated = ? WHERE id = ?").bind(Date.now(), row.ref_id).run();
  if (row.kind === 'order') await env.DB.prepare("UPDATE orders SET status = 'paid', paid_at = ?, updated = ? WHERE id = ? AND status IN ('requested', 'pending')").bind(Date.now(), Date.now(), row.ref_id).run();
  const to = c.alertEmail || c.contact.email;
  if (to) ctx.waitUntil(sendEmail(env, { to, subject: 'Payment received: ' + money(row.amount) + ' from ' + (row.name || row.email), text: `${row.name || row.email} paid ${money(row.amount)} for: ${row.description}\n\nOpen your admin: ${url.origin}/admin/` }));
  if (row.email) ctx.waitUntil(sendEmail(env, { to: row.email, subject: 'Payment received, thank you', text: `Hello${row.name ? ' ' + row.name.split(' ')[0] : ''},\n\nThank you. Your payment of ${money(row.amount)} for "${row.description}" went through.\n\n${c.name}` }));
}

/* ---------- enquiries (sorted into her inbox sections) ---------- */
async function enquire(req, env, ctx, url, c, page) {
  if (!sameOrigin(req, url)) return new Response('Request blocked for security reasons.', { status: 403 });
  const f = await readForm(req); if (!f) return redirect('/contact/');
  const source = ['home', 'bespoke', 'weddings', 'contact'].includes(f.source) ? f.source : 'contact';
  const v = {
    name: line(f.name, 80), email: line(f.email, 120).toLowerCase(), phone: line(f.phone, 30),
    occasion: OCCASIONS.map(o => o[0]).includes(f.occasion) ? f.occasion : 'Something else',
    event_date: isoDate(f.event_date), quantity: line(f.quantity, 40), venue: line(f.venue, 120), budget: line(f.budget, 40),
    message: clean(f.message, 4000), allergies: line(f.allergies, 300)
  };
  const errors = [];
  if (f.website) return redirect('/enquire/thanks/'); // the hidden spam trap was filled in
  const rl = await limit(env, req, 'enq', 6, 3600);
  if (rl.blocked) errors.push('Too many messages from here in the last hour. Please try again later, or email directly.');
  const tk = await checkToken(env, f.t);
  if (tk === 'fast') errors.push('That was quick. Please check your message and press Send again.');
  else if (tk === 'used') return redirect('/enquire/thanks/?n=' + encodeURIComponent(v.name.split(' ')[0] || ''));
  else if (tk !== 'ok') errors.push('The form expired. Please press Send again.');
  if (v.name.length < 2) errors.push('Enter your name.');
  if (!EMAIL_RE.test(v.email)) errors.push('Enter a valid email address.');
  if (v.message.length < 5) errors.push('Tell me a little about what you need.');
  if (/https?:\/\/\S+.*https?:\/\/\S+.*https?:\/\//is.test(v.message)) errors.push('Please remove the links from your message.');
  if (errors.length) {
    const token = await formToken(env);
    const body = source === 'weddings' ? P.weddingsPage(c, { token, values: v, errors }) : source === 'contact' ? P.contactPage(c, { token, values: v, errors }) : P.bespokePage(c, { token, values: v, errors });
    return page('Please check the form', body, { status: 400, noCount: true, noindex: true });
  }
  await rl.hit();
  const section = (OCCASIONS.find(o => o[0] === v.occasion) || [])[1] || 'general';
  const id = 'm' + randomHex(10), now = Date.now();
  await env.DB.prepare('INSERT INTO messages (id, created, section, name, email, phone, occasion, event_date, quantity, budget, venue, message, allergies, source, updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id, now, section, v.name, v.email, v.phone, v.occasion, v.event_date, v.quantity, v.budget, v.venue, v.message, v.allergies, source, now).run();
  const to = c.alertEmail || c.contact.email;
  if (to) ctx.waitUntil(sendEmail(env, { to, subject: `New enquiry: ${v.occasion} from ${v.name}`, text: `${v.name} (${v.email}${v.phone ? ', ' + v.phone : ''})\n${v.occasion}${v.event_date ? ', ' + niceDate(v.event_date) : ''}${v.quantity ? ', ' + v.quantity : ''}${v.venue ? '\nVenue: ' + v.venue : ''}${v.budget ? '\nBudget: ' + v.budget : ''}${v.allergies ? '\nAllergies: ' + v.allergies : ''}\n\n${v.message}\n\nReply from your admin: ${url.origin}/admin/` }));
  return redirect('/enquire/thanks/?n=' + encodeURIComponent(v.name.split(' ')[0] || ''));
}
