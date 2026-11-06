// The private admin: login, inbox sections, orders, products, photos, gallery, journal, page text, payment links and stats.
// Every /admin/api/ call needs a valid session cookie (HttpOnly, Secure, SameSite=Strict), a same-site Origin
// and a custom header, so other websites can't act on her behalf. Passwords are stored only as PBKDF2 hashes.
import { json, sameOrigin, readJson, clean, line, EMAIL_RE, normPhone, randomHex, sha256hex, safeEqual, hashPassword, verifyPassword, passwordProblem, createSession, getSession, endSession, limit, log, todayUK, addDays, isoDate, slugify, ADMIN_CSP } from './lib.js';
import { getContent, saveContent, DEFAULT_CONTENT, SECTIONS, SECTION_IDS, MESSAGE_STATUSES, ORDER_STATUSES, ALLERGENS, ALLERGEN_IDS, productRow, safeArr, STOCK } from './db.js';
import { stripeReady, stripeMode } from './stripe.js';
import { emailReady, sendEmail } from './email.js';

export const ADMIN_HEADERS = { csp: ADMIN_CSP };
const MAX_FAILS = 6;

export async function adminRoute(req, env, ctx, url) {
  const p = url.pathname;
  if (!p.startsWith('/admin/api/')) return null;
  const m = req.method;
  if (m !== 'GET' && (!sameOrigin(req, url) || req.headers.get('x-requested-with') !== 'choc')) return json({ error: 'Request blocked for security reasons.' }, 403);
  const api = p.slice('/admin/api/'.length).replace(/\/$/, '');
  const body = m === 'GET' || m === 'DELETE' ? {} : (await readJson(req, api === 'photos' ? 4 * 1024 * 1024 : 256 * 1024));
  if (body === null) return json({ error: 'That request was too large or not valid.' }, 400);

  // ---- before login ----
  if (api === 'me' && m === 'GET') {
    const s = await getSession(req, env);
    const admins = await env.DB.prepare('SELECT COUNT(*) AS n FROM admins').first();
    return json({ user: s ? s.username : null, needsSetup: !admins.n });
  }
  if (api === 'setup' && m === 'POST') return setup(req, env, body);
  if (api === 'login' && m === 'POST') return login(req, env, body);
  if (api === 'logout' && m === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': await endSession(req, env) });

  const s = await getSession(req, env);
  if (!s) return json({ error: 'Please log in again.', login: true }, 401);
  const who = s.username;
  const parts = api.split('/'), [res, id, sub] = parts;

  if (res === 'dashboard' && m === 'GET') return dashboard(env);
  if (res === 'messages') return messages(req, env, ctx, url, m, id, sub, body, who);
  if (res === 'orders') return orders(req, env, ctx, url, m, id, sub, body, who);
  if (res === 'links' && m === 'GET') { const { results } = await env.DB.prepare('SELECT id, kind, ref_id, name, email, description, amount, status, created, paid_at, expires FROM payments ORDER BY created DESC LIMIT 200').all(); return json({ links: results }); }
  if (res === 'links' && id && m === 'DELETE') { await env.DB.prepare("UPDATE payments SET status = 'cancelled' WHERE id = ? AND status = 'open'").bind(id).run(); await log(env, req, who, 'Cancelled a payment link'); return json({ ok: true }); }
  if (res === 'products') return products(req, env, m, id, body, who);
  if (res === 'photos' && m === 'POST') return upload(env, body);
  if (res === 'gallery') return gallery(req, env, m, id, body, who);
  if (res === 'posts') return posts(req, env, m, id, body, who);
  if (res === 'content' && m === 'GET') return json({ content: await getContent(env, true), defaults: DEFAULT_CONTENT, stock: Object.fromEntries(Object.entries(STOCK).map(([k, v]) => [k, { alt: v.alt }])) });
  if (res === 'content' && m === 'PUT') return putContent(req, env, body, who);
  if (res === 'status' && m === 'GET') return status(env, url);
  if (res === 'stats' && m === 'GET') return stats(env);
  if (res === 'account') return account(req, env, m, id, body, who);
  if (res === 'export' && m === 'GET') return exportPerson(env, url.searchParams.get('email'));
  return json({ error: 'Not found' }, 404);
}

/* ---------- login ---------- */
async function setup(req, env, b) {
  const have = await env.DB.prepare('SELECT COUNT(*) AS n FROM admins').first();
  if (have.n) return json({ error: 'Setup is already done. Please log in.' }, 400);
  const rl = await limit(env, req, 'setup', 5, 3600);
  if (rl.blocked) return json({ error: 'Too many attempts. Try again in an hour.' }, 429);
  const code = String(b.code || '').trim();
  const stored = await env.DB.prepare("SELECT value FROM settings WHERE key = 'setup_code_hash'").first();
  const okSecret = env.SETUP_CODE && String(env.SETUP_CODE).length >= 8 && await safeEqual(code, String(env.SETUP_CODE));
  const okStored = stored && code.length >= 8 && await safeEqual(await sha256hex(code), stored.value);
  if (!okSecret && !okStored) { await rl.hit(); return json({ error: 'That setup code is not right.' }, 403); }
  const username = line(b.username, 40).toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) return json({ error: 'Choose a username of 3 to 40 letters or numbers.' }, 400);
  const prob = passwordProblem(b.password, username); if (prob) return json({ error: prob }, 400);
  const r = await env.DB.prepare('INSERT INTO admins (username, hash, created) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM admins)').bind(username, await hashPassword(String(b.password)), Date.now()).run();
  if (!(r.meta && r.meta.changes)) return json({ error: 'Setup is already done. Please log in.' }, 400);
  await env.DB.prepare("DELETE FROM settings WHERE key = 'setup_code_hash'").run(); // the one-time code can never be used again
  await log(env, req, username, 'Created the first login');
  return json({ ok: true, user: username }, 200, { 'Set-Cookie': await createSession(env, username) });
}
async function login(req, env, b) {
  const rl = await limit(env, req, 'login', MAX_FAILS, 15 * 60);
  if (rl.blocked) return json({ error: 'Too many wrong attempts. Wait 15 minutes and try again.' }, 429);
  const username = line(b.username, 40).toLowerCase();
  const row = await env.DB.prepare('SELECT hash FROM admins WHERE username = ?').bind(username).first();
  const ok = await verifyPassword(String(b.password || '').slice(0, 200), row ? row.hash : '');
  if (!row || !ok) { await rl.hit(); await log(env, req, username || '(blank)', 'Failed login'); return json({ error: 'That username or password is not right.' }, 401); }
  await rl.clear();
  await log(env, req, username, 'Logged in');
  return json({ ok: true, user: username }, 200, { 'Set-Cookie': await createSession(env, username) });
}
async function account(req, env, m, id, b, who) {
  if (m === 'GET') {
    const [admins, logRows] = await Promise.all([env.DB.prepare('SELECT username, created FROM admins ORDER BY created').all(), env.DB.prepare('SELECT at, who, action, place FROM log ORDER BY id DESC LIMIT 60').all()]);
    return json({ me: who, admins: admins.results, log: logRows.results });
  }
  if (m === 'POST' && id === 'password') {
    const row = await env.DB.prepare('SELECT hash FROM admins WHERE username = ?').bind(who).first();
    if (!(await verifyPassword(String(b.current || ''), row.hash))) return json({ error: 'Your current password is not right.' }, 400);
    const prob = passwordProblem(b.password, who); if (prob) return json({ error: prob }, 400);
    await env.DB.batch([env.DB.prepare('UPDATE admins SET hash = ? WHERE username = ?').bind(await hashPassword(String(b.password)), who), env.DB.prepare('DELETE FROM sessions WHERE username = ?').bind(who)]);
    await log(env, req, who, 'Changed password');
    return json({ ok: true, user: who }, 200, { 'Set-Cookie': await createSession(env, who) });
  }
  if (m === 'POST' && id === 'users') {
    const username = line(b.username, 40).toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) return json({ error: 'Choose a username of 3 to 40 letters or numbers.' }, 400);
    const prob = passwordProblem(b.password, username); if (prob) return json({ error: prob }, 400);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM admins').first(); if (n.n >= 5) return json({ error: 'There are already 5 logins.' }, 400);
    const r = await env.DB.prepare('INSERT OR IGNORE INTO admins (username, hash, created) VALUES (?, ?, ?)').bind(username, await hashPassword(String(b.password)), Date.now()).run();
    if (!(r.meta && r.meta.changes)) return json({ error: 'That username is taken.' }, 400);
    await log(env, req, who, 'Added login ' + username);
    return json({ ok: true });
  }
  if (m === 'DELETE' && id === 'users') {
    const u = line(new URL(req.url).searchParams.get('u'), 40).toLowerCase();
    if (u === who) return json({ error: "You can't remove the login you are using." }, 400);
    await env.DB.batch([env.DB.prepare('DELETE FROM admins WHERE username = ?').bind(u), env.DB.prepare('DELETE FROM sessions WHERE username = ?').bind(u)]);
    await log(env, req, who, 'Removed login ' + u);
    return json({ ok: true });
  }
  if (m === 'POST' && id === 'logout-all') { await env.DB.prepare('DELETE FROM sessions').run(); await log(env, req, who, 'Logged out every device'); return json({ ok: true }); }
  return json({ error: 'Not found' }, 404);
}

/* ---------- dashboard ---------- */
async function dashboard(env) {
  const monthStart = new Date(todayUK().slice(0, 8) + '01T00:00:00Z').getTime();
  const [secs, todo, money, links, visits, c] = await Promise.all([
    env.DB.prepare("SELECT section, SUM(unread) AS unread, SUM(CASE WHEN status IN ('new','replied','quoted') THEN 1 ELSE 0 END) AS open FROM messages GROUP BY section").all(),
    env.DB.prepare("SELECT id, ref, name, date_needed, status, total, fulfilment FROM orders WHERE status IN ('requested','paid','making','ready') ORDER BY date_needed LIMIT 12").all(),
    env.DB.prepare("SELECT COALESCE(SUM(total),0) AS orders, COUNT(*) AS n FROM orders WHERE paid_at >= ?").bind(monthStart).first(),
    env.DB.prepare("SELECT COALESCE(SUM(amount),0) AS amt, COUNT(*) AS n FROM payments WHERE kind = 'message' AND paid_at >= ?").bind(monthStart).first(),
    env.DB.prepare('SELECT COALESCE(SUM(n),0) AS n FROM hits WHERE day >= ?').bind(addDays(todayUK(), -6)).first(),
    getContent(env, true)
  ]);
  return json({ sections: SECTIONS.map(x => ({ ...x, ...(secs.results.find(r => r.section === x.id) || { unread: 0, open: 0 }) })), orders: todo.results, month: { orders: money.orders, orderCount: money.n, quotes: links.amt, quoteCount: links.n }, visits7: visits.n, checklist: await checklist(env, c) });
}
async function checklist(env, c) {
  const pub = await env.DB.prepare('SELECT COUNT(*) AS n FROM products WHERE published = 1 AND price > 0 AND allergens_checked = 1').first();
  return [
    { done: c.name !== DEFAULT_CONTENT.name || !!c.legal.tradingName, text: 'Add the business name', go: 'pages' },
    { done: !!c.contact.email, text: 'Add a contact email', go: 'pages' },
    { done: !!c.legal.address, text: 'Add the business address for the terms of sale (the law requires it for online sales)', go: 'pages' },
    { done: !!c.allergenConfirmed, text: 'Check the allergen statement is right for the kitchen', go: 'pages' },
    { done: pub.n > 0, text: 'Publish at least one product with a price and checked allergens', go: 'products' },
    { done: stripeReady(env), text: 'Connect Stripe so customers can pay by card', go: 'settings' },
    { done: emailReady(env), text: 'Turn on email alerts for new orders and enquiries', go: 'settings' }
  ];
}

/* ---------- messages (inbox sections) ---------- */
async function messages(req, env, ctx, url, m, id, sub, b, who) {
  if (m === 'GET' && !id) {
    const sec = url.searchParams.get('section') || '', st = url.searchParams.get('status') || '', q = clean(url.searchParams.get('q'), 60);
    const where = [], args = [];
    if (SECTION_IDS.includes(sec)) { where.push('section = ?'); args.push(sec); }
    if (st === 'open') where.push("status IN ('new','replied','quoted')");
    else if (st === 'done') where.push("status IN ('booked','paid','closed')");
    else if (st === 'unread') where.push('unread = 1');
    if (q) { where.push('(name LIKE ? OR email LIKE ? OR message LIKE ?)'); args.push('%' + q + '%', '%' + q + '%', '%' + q + '%'); }
    const { results } = await env.DB.prepare(`SELECT id, created, section, status, unread, name, email, occasion, event_date, quantity, substr(message, 1, 140) AS preview FROM messages ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created DESC LIMIT 300`).bind(...args).all();
    const counts = await env.DB.prepare("SELECT section, COUNT(*) AS total, SUM(unread) AS unread FROM messages GROUP BY section").all();
    return json({ messages: results, sections: SECTIONS, counts: counts.results, statuses: MESSAGE_STATUSES });
  }
  if (!/^m[a-f0-9]{20}$/.test(id || '')) return json({ error: 'Not found' }, 404);
  const msg = await env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(id).first();
  if (!msg) return json({ error: 'That message was deleted.' }, 404);
  if (m === 'GET') {
    if (msg.unread) await env.DB.prepare('UPDATE messages SET unread = 0 WHERE id = ?').bind(id).run();
    const [links, others] = await Promise.all([env.DB.prepare("SELECT id, description, amount, status, created, paid_at, expires FROM payments WHERE kind = 'message' AND ref_id = ? ORDER BY created DESC").bind(id).all(), env.DB.prepare('SELECT id, created, occasion, section FROM messages WHERE email = ? AND id != ? ORDER BY created DESC LIMIT 10').bind(msg.email, id).all()]);
    return json({ message: { ...msg, unread: 0 }, links: links.results, others: others.results, sections: SECTIONS, statuses: MESSAGE_STATUSES, payReady: stripeReady(env) });
  }
  if (m === 'PATCH') {
    const set = [], args = [];
    if (b.section !== undefined) { if (!SECTION_IDS.includes(b.section)) return json({ error: 'Unknown section.' }, 400); set.push('section = ?'); args.push(b.section); }
    if (b.status !== undefined) { if (!MESSAGE_STATUSES.includes(b.status)) return json({ error: 'Unknown status.' }, 400); set.push('status = ?'); args.push(b.status); }
    if (b.notes !== undefined) { set.push('notes = ?'); args.push(clean(b.notes, 4000)); }
    if (b.unread !== undefined) { set.push('unread = ?'); args.push(b.unread ? 1 : 0); }
    if (!set.length) return json({ ok: true });
    await env.DB.prepare(`UPDATE messages SET ${set.join(', ')}, updated = ? WHERE id = ?`).bind(...args, Date.now(), id).run();
    return json({ ok: true });
  }
  if (m === 'DELETE') { await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(id).run(); await log(env, req, who, 'Deleted a message from ' + msg.name); return json({ ok: true }); }
  if (m === 'POST' && sub === 'link') return makeLink(req, env, ctx, url, who, b, { kind: 'message', ref_id: id, name: msg.name, email: msg.email, after: () => env.DB.prepare("UPDATE messages SET status = 'quoted', updated = ? WHERE id = ? AND status IN ('new','replied')").bind(Date.now(), id).run() });
  return json({ error: 'Not found' }, 404);
}

async function makeLink(req, env, ctx, url, who, b, { kind, ref_id, name, email, after }) {
  const amount = Math.round(Number(String(b.amount || '').replace(/[£,\s]/g, '')) * 100);
  const description = line(b.description, 120);
  const days = Math.min(Math.max(parseInt(b.days, 10) || 14, 1), 60);
  if (!(amount >= 50) || amount > 1000000) return json({ error: 'Enter an amount between £0.50 and £10,000.' }, 400);
  if (description.length < 3) return json({ error: 'Describe what the payment is for, e.g. "Deposit for 80 wedding favours".' }, 400);
  const id = randomHex(8), secret = randomHex(24), now = Date.now();
  await env.DB.prepare('INSERT INTO payments (id, secret, kind, ref_id, name, email, description, amount, created, expires) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(id, await sha256hex(secret), kind, ref_id, name, email, description, amount, now, now + days * 86400000).run();
  if (after) await after();
  const link = `${url.origin}/pay/${id}.${secret}/`;
  let emailed = false;
  if (b.send && email && emailReady(env)) {
    const c = await getContent(env);
    emailed = await sendEmail(env, { to: email, subject: `Your ${c.name} payment link`, text: `Hello${name ? ' ' + name.split(' ')[0] : ''},\n\n${clean(b.note, 2000) ? clean(b.note, 2000) + '\n\n' : ''}${description}: £${(amount / 100).toFixed(2)}\n\nPay securely here (the link works for ${days} days):\n${link}\n\n${c.name}` });
  }
  await log(env, req, who, `Made a payment link for £${(amount / 100).toFixed(2)} (${name || email})`);
  return json({ ok: true, link, emailed });
}

/* ---------- orders ---------- */
async function orders(req, env, ctx, url, m, id, sub, b, who) {
  if (m === 'GET' && !id) {
    const st = url.searchParams.get('status') || 'active';
    const groups = { active: "status IN ('requested','paid','making','ready')", done: "status = 'done'", cancelled: "status = 'cancelled'", pending: "status = 'pending'" };
    const { results } = await env.DB.prepare(`SELECT id, ref, created, status, name, email, fulfilment, date_needed, total, items FROM orders WHERE ${groups[st] || groups.active} ORDER BY ${st === 'active' ? 'date_needed ASC' : 'created DESC'} LIMIT 300`).all();
    return json({ orders: results.map(o => ({ ...o, items: safeArr(o.items) })), statuses: ORDER_STATUSES });
  }
  if (!/^o[a-f0-9]{20}$/.test(id || '')) return json({ error: 'Not found' }, 404);
  const o = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
  if (!o) return json({ error: 'That order was deleted.' }, 404);
  if (m === 'GET') { const links = await env.DB.prepare("SELECT id, description, amount, status, created, paid_at FROM payments WHERE kind = 'order' AND ref_id = ? ORDER BY created DESC").bind(id).all(); return json({ order: { ...o, items: safeArr(o.items) }, links: links.results, payReady: stripeReady(env), statuses: ORDER_STATUSES }); }
  if (m === 'PATCH') {
    const set = [], args = [];
    if (b.status !== undefined) {
      if (!ORDER_STATUSES.includes(b.status) || b.status === 'pending') return json({ error: 'Unknown status.' }, 400);
      if (b.status === 'paid' && !o.paid_at) { set.push('paid_at = ?'); args.push(Date.now()); }
      set.push('status = ?'); args.push(b.status);
    }
    if (b.admin_notes !== undefined) { set.push('admin_notes = ?'); args.push(clean(b.admin_notes, 4000)); }
    if (!set.length) return json({ ok: true });
    await env.DB.prepare(`UPDATE orders SET ${set.join(', ')}, updated = ? WHERE id = ?`).bind(...args, Date.now(), id).run();
    if (b.status && b.status !== o.status) await log(env, req, who, `Order ${o.ref} marked ${b.status}`);
    if (b.status === 'ready' && b.notify && emailReady(env)) {
      const c = await getContent(env);
      ctx.waitUntil(sendEmail(env, { to: o.email, subject: `Your order ${o.ref} is ready`, text: `Hello ${o.name.split(' ')[0]},\n\nYour order ${o.ref} is ready${o.fulfilment === 'collect' ? ' to collect' : ' and on its way'}.${clean(b.message, 1000) ? '\n\n' + clean(b.message, 1000) : ''}\n\n${c.name}` }));
    }
    return json({ ok: true });
  }
  if (m === 'POST' && sub === 'link') return makeLink(req, env, ctx, url, who, { description: 'Order ' + o.ref, amount: (o.total / 100).toFixed(2), ...b }, { kind: 'order', ref_id: id, name: o.name, email: o.email });
  if (m === 'DELETE') {
    if (['paid', 'making', 'ready', 'done'].includes(o.status)) return json({ error: 'Paid orders are kept for your tax records. Mark it cancelled instead (and refund it in Stripe if needed).' }, 400);
    await env.DB.prepare('DELETE FROM orders WHERE id = ?').bind(id).run(); await log(env, req, who, 'Deleted order ' + o.ref); return json({ ok: true });
  }
  return json({ error: 'Not found' }, 404);
}

/* ---------- products ---------- */
async function products(req, env, m, id, b, who) {
  if (m === 'GET') { const { results } = await env.DB.prepare('SELECT * FROM products ORDER BY sort, name').all(); return json({ products: results.map(productRow), allergens: ALLERGENS }); }
  if (m === 'POST' && id === 'order') { const ids = Array.isArray(b.ids) ? b.ids.slice(0, 300) : []; await env.DB.batch(ids.map((x, i) => env.DB.prepare('UPDATE products SET sort = ? WHERE id = ?').bind(i, String(x)))); return json({ ok: true }); }
  const v = {
    name: line(b.name, 80), category: line(b.category, 40), summary: line(b.summary, 200), description: clean(b.description, 4000), ingredients: clean(b.ingredients, 2000),
    allergens: (Array.isArray(b.allergens) ? b.allergens : []).filter(a => ALLERGEN_IDS.includes(a)), may_contain: line(b.may_contain, 200), allergens_checked: b.allergens_checked ? 1 : 0,
    photo: /^[a-z0-9]{8,40}$/.test(b.photo || '') || /^stock:[a-z]+$/.test(b.photo || '') ? b.photo : '',
    published: b.published ? 1 : 0, sold_out: b.sold_out ? 1 : 0,
    notice_days: Math.min(Math.max(parseInt(b.notice_days, 10) || 0, 0), 90), max_qty: Math.min(Math.max(parseInt(b.max_qty, 10) || 20, 1), 50)
  };
  const price = b.price === '' || b.price == null ? null : Math.round(Number(String(b.price).replace(/[£,\s]/g, '')) * 100);
  if (m === 'POST' || m === 'PUT') {
    if (v.name.length < 2) return json({ error: 'Give the product a name.' }, 400);
    if (price !== null && (!(price >= 50) || price > 500000)) return json({ error: 'Enter a price between £0.50 and £5,000, or leave it empty.' }, 400);
    if (v.published && price === null) return json({ error: 'Add a price before publishing.' }, 400);
    if (v.published && !v.allergens_checked) return json({ error: 'Tick the allergens as checked before publishing. The law requires allergen information for food sold online.' }, 400);
  }
  if (m === 'POST' && !id) {
    const pid = 'p' + randomHex(6); let slug = slugify(v.name);
    if (await env.DB.prepare('SELECT 1 FROM products WHERE slug = ?').bind(slug).first()) slug = slug.slice(0, 50) + '-' + randomHex(2);
    await env.DB.prepare('INSERT INTO products (id, slug, name, category, price, summary, description, ingredients, allergens, may_contain, allergens_checked, photo, published, sold_out, notice_days, max_qty, sort, updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(pid, slug, v.name, v.category, price, v.summary, v.description, v.ingredients, JSON.stringify(v.allergens), v.may_contain, v.allergens_checked, v.photo, v.published, v.sold_out, v.notice_days, v.max_qty, 999, Date.now()).run();
    await log(env, req, who, 'Added product ' + v.name);
    return json({ ok: true, id: pid, slug });
  }
  if (!/^p[a-f0-9]{12}$/.test(id || '')) return json({ error: 'Not found' }, 404);
  if (m === 'PUT') {
    const r = await env.DB.prepare('UPDATE products SET name=?, category=?, price=?, summary=?, description=?, ingredients=?, allergens=?, may_contain=?, allergens_checked=?, photo=?, published=?, sold_out=?, notice_days=?, max_qty=?, updated=? WHERE id = ?')
      .bind(v.name, v.category, price, v.summary, v.description, v.ingredients, JSON.stringify(v.allergens), v.may_contain, v.allergens_checked, v.photo, v.published, v.sold_out, v.notice_days, v.max_qty, Date.now(), id).run();
    if (!(r.meta && r.meta.changes)) return json({ error: 'That product was deleted.' }, 404);
    await log(env, req, who, 'Updated product ' + v.name);
    return json({ ok: true });
  }
  if (m === 'DELETE') { await env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run(); await log(env, req, who, 'Deleted a product'); return json({ ok: true }); }
  return json({ error: 'Not found' }, 404);
}

/* ---------- photo upload (resized and stripped of location data in the browser before upload) ---------- */
async function upload(env, b) {
  const m = /^data:(image\/(?:jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.data || ''));
  if (!m) return json({ error: 'That photo could not be read. Try a JPEG or PNG.' }, 400);
  let bytes; try { bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0)); } catch { return json({ error: 'That photo could not be read.' }, 400); }
  if (bytes.length > 1.8 * 1024 * 1024) return json({ error: 'That photo is too large.' }, 400);
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8, webp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (!(jpeg && m[1] === 'image/jpeg') && !(webp && m[1] === 'image/webp')) return json({ error: 'That file is not a photo.' }, 400);
  const id = randomHex(10);
  await env.DB.prepare('INSERT INTO photos (id, data, type, w, h, created) VALUES (?, ?, ?, ?, ?, ?)').bind(id, bytes, m[1], parseInt(b.w, 10) || null, parseInt(b.h, 10) || null, Date.now()).run();
  return json({ ok: true, id, url: '/photos/' + id + '.jpg' });
}

/* ---------- gallery ---------- */
async function gallery(req, env, m, id, b, who) {
  if (m === 'GET') { const { results } = await env.DB.prepare('SELECT * FROM gallery ORDER BY sort, created').all(); return json({ items: results }); }
  if (m === 'POST' && id === 'order') { const ids = Array.isArray(b.ids) ? b.ids.slice(0, 500) : []; await env.DB.batch(ids.map((x, i) => env.DB.prepare('UPDATE gallery SET sort = ? WHERE id = ?').bind(i, String(x)))); return json({ ok: true }); }
  const photo = /^[a-z0-9]{8,40}$/.test(b.photo || '') || /^stock:[a-z]+$/.test(b.photo || '') ? b.photo : '';
  if (m === 'POST' && !id) { if (!photo) return json({ error: 'Upload a photo first.' }, 400); const gid = 'g' + randomHex(8); await env.DB.prepare('INSERT INTO gallery (id, photo, caption, sort, created) VALUES (?, ?, ?, ?, ?)').bind(gid, photo, line(b.caption, 140), -1, Date.now()).run(); await log(env, req, who, 'Added a gallery photo'); return json({ ok: true, id: gid }); }
  if (m === 'PATCH') { await env.DB.prepare('UPDATE gallery SET caption = ? WHERE id = ?').bind(line(b.caption, 140), id || '').run(); return json({ ok: true }); }
  if (m === 'DELETE') { await env.DB.prepare('DELETE FROM gallery WHERE id = ?').bind(id || '').run(); await log(env, req, who, 'Removed a gallery photo'); return json({ ok: true }); }
  return json({ error: 'Not found' }, 404);
}

/* ---------- journal ---------- */
async function posts(req, env, m, id, b, who) {
  if (m === 'GET') { const { results } = await env.DB.prepare('SELECT * FROM posts ORDER BY created DESC').all(); return json({ posts: results }); }
  const v = { title: line(b.title, 120), summary: line(b.summary, 240), body: clean(b.body, 20000), photo: /^[a-z0-9]{8,40}$/.test(b.photo || '') || /^stock:[a-z]+$/.test(b.photo || '') ? b.photo : '', published: b.published ? 1 : 0 };
  if ((m === 'POST' || m === 'PUT') && v.title.length < 3) return json({ error: 'Give the post a title.' }, 400);
  if (m === 'POST') { const pid = 'j' + randomHex(8); let slug = slugify(v.title); if (await env.DB.prepare('SELECT 1 FROM posts WHERE slug = ?').bind(slug).first()) slug = slug.slice(0, 50) + '-' + randomHex(2); await env.DB.prepare('INSERT INTO posts (id, slug, title, summary, body, photo, published, created, updated) VALUES (?,?,?,?,?,?,?,?,?)').bind(pid, slug, v.title, v.summary, v.body, v.photo, v.published, Date.now(), Date.now()).run(); await log(env, req, who, 'Wrote journal post ' + v.title); return json({ ok: true, id: pid, slug }); }
  if (m === 'PUT') { await env.DB.prepare('UPDATE posts SET title=?, summary=?, body=?, photo=?, published=?, updated=? WHERE id = ?').bind(v.title, v.summary, v.body, v.photo, v.published, Date.now(), id || '').run(); return json({ ok: true }); }
  if (m === 'DELETE') { await env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(id || '').run(); await log(env, req, who, 'Deleted a journal post'); return json({ ok: true }); }
  return json({ error: 'Not found' }, 404);
}

/* ---------- page text and settings ---------- */
async function putContent(req, env, b, who) {
  const c = b.content; if (!c || typeof c !== 'object') return json({ error: 'Nothing to save.' }, 400);
  const T = (v, n) => line(v, n), L = (v, n) => clean(v, n);
  const pairs = (a, n, k1 = 'title', k2 = 'text') => (Array.isArray(a) ? a : []).slice(0, n).map(x => ({ [k1]: T(x && x[k1], 120), [k2]: L(x && x[k2], 600) })).filter(x => x[k1]);
  const photo = v => /^[a-z0-9]{8,40}$/.test(v || '') || /^stock:[a-z]+$/.test(v || '') ? v : '';
  const pence = v => Math.min(Math.max(Math.round(Number(String(v ?? 0).replace(/[£,\s]/g, '')) * 100) || 0, 0), 100000);
  const https = v => { const s = T(v, 200); return /^https:\/\/[^\s"<>]+$/.test(s) ? s : ''; };
  const email = v => { const s = T(v, 120).toLowerCase(); return EMAIL_RE.test(s) ? s : ''; };
  const opt = (o, d) => ({ on: !!(o && o.on), fee: pence(o && o.feePounds), text: L(o && o.text, 300) || d.text });
  const out = {
    name: T(c.name, 60) || DEFAULT_CONTENT.name, heroTitle: T(c.heroTitle, 80) || DEFAULT_CONTENT.heroTitle, heroText: T(c.heroText, 160), heroPhoto: photo(c.heroPhoto) || DEFAULT_CONTENT.heroPhoto,
    makeIntro: T(c.makeIntro, 200), makeItems: pairs(c.makeItems, 8), makePhoto: photo(c.makePhoto), steps: pairs(c.steps, 6), orderPhoto: photo(c.orderPhoto),
    aboutTitle: T(c.aboutTitle, 80), aboutText: L(c.aboutText, 1500), weddingsTitle: T(c.weddingsTitle, 80) || DEFAULT_CONTENT.weddingsTitle, weddingsText: L(c.weddingsText, 600), weddingsPoints: pairs(c.weddingsPoints, 8),
    bespokeTitle: T(c.bespokeTitle, 80) || DEFAULT_CONTENT.bespokeTitle, bespokeText: L(c.bespokeText, 600),
    faq: (Array.isArray(c.faq) ? c.faq : []).slice(0, 30).map(x => ({ q: T(x && x.q, 160), a: L(x && x.a, 1500) })).filter(x => x.q && x.a),
    allergenStatement: L(c.allergenStatement, 1500) || DEFAULT_CONTENT.allergenStatement, allergenConfirmed: !!c.allergenConfirmed,
    contact: { email: email(c.contact && c.contact.email), phone: normPhone(c.contact && c.contact.phone), area: T(c.contact && c.contact.area, 80), address: L(c.contact && c.contact.address, 200), hours: T(c.contact && c.contact.hours, 120), instagram: https(c.contact && c.contact.instagram), facebook: https(c.contact && c.contact.facebook), tiktok: https(c.contact && c.contact.tiktok) },
    legal: { tradingName: T(c.legal && c.legal.tradingName, 100), ownerName: T(c.legal && c.legal.ownerName, 80), address: T(c.legal && c.legal.address, 200), companyNumber: T(c.legal && c.legal.companyNumber, 20), vatNumber: T(c.legal && c.legal.vatNumber, 20) },
    delivery: { collect: opt(c.delivery && c.delivery.collect, DEFAULT_CONTENT.delivery.collect), local: opt(c.delivery && c.delivery.local, DEFAULT_CONTENT.delivery.local), post: opt(c.delivery && c.delivery.post, DEFAULT_CONTENT.delivery.post) },
    noticeDays: Math.min(Math.max(parseInt(c.noticeDays, 10) || 0, 1), 90), shopOpen: !!c.shopOpen, closedMessage: T(c.closedMessage, 200) || DEFAULT_CONTENT.closedMessage,
    alertEmail: email(c.alertEmail), keepMessagesMonths: Math.min(Math.max(parseInt(c.keepMessagesMonths, 10) || 24, 3), 72)
  };
  if (!out.delivery.collect.on && !out.delivery.local.on && !out.delivery.post.on) return json({ error: 'Turn on at least one of collection, local delivery or UK delivery.' }, 400);
  if (c.contact && c.contact.phone && !out.contact.phone) return json({ error: 'That phone number does not look like a UK number.' }, 400);
  if (c.contact && c.contact.email && !out.contact.email) return json({ error: 'That contact email does not look right.' }, 400);
  await saveContent(env, out);
  await log(env, req, who, 'Updated the website text and settings');
  return json({ ok: true, content: out });
}

async function status(env, url) {
  return json({ stripe: stripeReady(env), mode: stripeReady(env) ? stripeMode(env) : '', webhook: !!env.STRIPE_WEBHOOK_SECRET, webhookUrl: url.origin + '/stripe/webhook', email: emailReady(env), checklist: await checklist(env, await getContent(env, true)) });
}
async function stats(env) {
  const from = addDays(todayUK(), -29);
  const [days, pages, refs] = await Promise.all([
    env.DB.prepare('SELECT day, SUM(n) AS n FROM hits WHERE day >= ? GROUP BY day ORDER BY day').bind(from).all(),
    env.DB.prepare('SELECT path, SUM(n) AS n FROM hits WHERE day >= ? GROUP BY path ORDER BY n DESC LIMIT 12').bind(from).all(),
    env.DB.prepare("SELECT ref, SUM(n) AS n FROM hits WHERE day >= ? AND ref != '' GROUP BY ref ORDER BY n DESC LIMIT 10").bind(from).all()
  ]);
  const map = Object.fromEntries(days.results.map(d => [d.day, d.n]));
  const series = []; for (let i = 29; i >= 0; i--) { const d = addDays(todayUK(), -i); series.push({ day: d, n: map[d] || 0 }); }
  return json({ days: series, pages: pages.results, refs: refs.results });
}
// a customer's subject access request: everything held about one email address, as JSON
async function exportPerson(env, email) {
  const e = line(email, 120).toLowerCase(); if (!EMAIL_RE.test(e)) return json({ error: 'Enter the customer’s email address.' }, 400);
  const [msgs, ords, pays] = await Promise.all([env.DB.prepare('SELECT * FROM messages WHERE email = ?').bind(e).all(), env.DB.prepare('SELECT * FROM orders WHERE email = ?').bind(e).all(), env.DB.prepare('SELECT id, description, amount, status, created, paid_at FROM payments WHERE email = ?').bind(e).all()]);
  return json({ email: e, exported: new Date().toISOString(), messages: msgs.results, orders: ords.results.map(o => ({ ...o, items: safeArr(o.items) })), payments: pays.results });
}
