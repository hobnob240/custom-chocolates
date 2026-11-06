// Database (Cloudflare D1): tables, default content and small data helpers.
import { randomHex } from './lib.js';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS admins (username TEXT PRIMARY KEY, hash TEXT NOT NULL, created INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, username TEXT NOT NULL, exp INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ratelimit (key TEXT PRIMARY KEY, n INTEGER NOT NULL, exp INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, who TEXT, action TEXT, place TEXT)`,
  `CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', price INTEGER, summary TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', ingredients TEXT NOT NULL DEFAULT '', allergens TEXT NOT NULL DEFAULT '[]', may_contain TEXT NOT NULL DEFAULT '', allergens_checked INTEGER NOT NULL DEFAULT 0, photo TEXT NOT NULL DEFAULT '', published INTEGER NOT NULL DEFAULT 0, sold_out INTEGER NOT NULL DEFAULT 0, notice_days INTEGER NOT NULL DEFAULT 0, max_qty INTEGER NOT NULL DEFAULT 20, sort INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, ref TEXT UNIQUE NOT NULL, created INTEGER NOT NULL, status TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', fulfilment TEXT NOT NULL, address TEXT NOT NULL DEFAULT '', date_needed TEXT NOT NULL DEFAULT '', items TEXT NOT NULL, subtotal INTEGER NOT NULL, delivery_fee INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL, gift_message TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', stripe_session TEXT NOT NULL DEFAULT '', paid_at INTEGER, admin_notes TEXT NOT NULL DEFAULT '', updated INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS orders_status ON orders (status, created)`,
  `CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, created INTEGER NOT NULL, section TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', unread INTEGER NOT NULL DEFAULT 1, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', occasion TEXT NOT NULL DEFAULT '', event_date TEXT NOT NULL DEFAULT '', quantity TEXT NOT NULL DEFAULT '', budget TEXT NOT NULL DEFAULT '', venue TEXT NOT NULL DEFAULT '', fulfilment TEXT NOT NULL DEFAULT '', message TEXT NOT NULL DEFAULT '', allergies TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', updated INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS messages_section ON messages (section, created)`,
  `CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, secret TEXT NOT NULL, kind TEXT NOT NULL, ref_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', description TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open', stripe_session TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, paid_at INTEGER, expires INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, data BLOB NOT NULL, type TEXT NOT NULL, w INTEGER, h INTEGER, created INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS gallery (id TEXT PRIMARY KEY, photo TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '', sort INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', photo TEXT NOT NULL DEFAULT '', published INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, updated INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS hits (day TEXT NOT NULL, path TEXT NOT NULL, ref TEXT NOT NULL DEFAULT '', n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, path, ref))`
];

let ready = false;
export async function ensureDb(env) {
  if (ready) return;
  await env.DB.batch(SCHEMA.map(q => env.DB.prepare(q)));
  const have = await env.DB.prepare("SELECT value FROM settings WHERE key = 'seeded'").first();
  if (!have) await seed(env);
  ready = true;
}

/* ---------- the inbox sections (her message folders) ---------- */
export const SECTIONS = [
  { id: 'wedding', name: 'Weddings' },
  { id: 'celebration', name: 'Birthdays and celebrations' },
  { id: 'corporate', name: 'Business and events' },
  { id: 'bespoke', name: 'Bespoke designs' },
  { id: 'order', name: 'Order questions' },
  { id: 'general', name: 'General enquiries' }
];
export const SECTION_IDS = SECTIONS.map(s => s.id);
// what the customer picks on the form -> which folder it lands in
export const OCCASIONS = [
  ['Wedding', 'wedding'], ['Engagement or anniversary', 'wedding'], ['Birthday', 'celebration'], ['Christening, baby shower or celebration', 'celebration'],
  ['Corporate gifts or an event', 'corporate'], ['A bespoke design', 'bespoke'], ['A question about an order', 'order'], ['Something else', 'general']
];
export const MESSAGE_STATUSES = ['new', 'replied', 'quoted', 'booked', 'paid', 'closed'];
export const ORDER_STATUSES = ['requested', 'pending', 'paid', 'making', 'ready', 'done', 'cancelled'];

/* ---------- the 14 allergens UK law requires food businesses to declare ---------- */
export const ALLERGENS = [
  ['celery', 'Celery'], ['gluten', 'Cereals containing gluten'], ['crustaceans', 'Crustaceans'], ['eggs', 'Eggs'], ['fish', 'Fish'], ['lupin', 'Lupin'], ['milk', 'Milk'],
  ['molluscs', 'Molluscs'], ['mustard', 'Mustard'], ['nuts', 'Tree nuts'], ['peanuts', 'Peanuts'], ['sesame', 'Sesame'], ['soya', 'Soya'], ['sulphites', 'Sulphur dioxide and sulphites']
];
export const ALLERGEN_IDS = ALLERGENS.map(a => a[0]);

/* ---------- editable site content (the "Pages" screen in her admin) ---------- */
export const DEFAULT_CONTENT = {
  name: 'Handmade Chocolates',
  heroTitle: 'Chocolates made for your occasion',
  heroText: 'Handmade to order for weddings, birthdays, gifts and thank-yous.',
  heroPhoto: 'stock:melted',
  makeIntro: 'Every box starts with a conversation, so nothing is off the shelf.',
  makeItems: [
    { title: 'Wedding favours', text: 'A chocolate or two for every guest, boxed to match the day.' },
    { title: 'Birthday and celebration boxes', text: 'Their favourite flavours, a name or a number on top.' },
    { title: 'Gifts and thank-yous', text: 'For teachers, hosts, clients, or anyone who deserves better than a card.' },
    { title: 'Business and event orders', text: 'Chocolates for clients, staff or guests, made in larger runs.' },
    { title: 'Your own design', text: 'Colours, shapes, letters and flavours chosen with you.' }
  ],
  makePhoto: 'stock:pralines',
  steps: [
    { title: 'Tell me the occasion', text: 'The date, how many people, and anything you have in mind.' },
    { title: 'We choose together', text: 'Flavours, colours, wording and packaging, with a price before anything is made.' },
    { title: 'Made by hand', text: 'Your chocolates are made fresh for your date, in small batches.' },
    { title: 'Ready for the day', text: 'Collected or delivered, boxed and labelled with full ingredients.' }
  ],
  orderPhoto: 'stock:dome',
  aboutTitle: 'Made by hand, one order at a time',
  aboutText: 'Every chocolate is made by hand, to order, for the people it is meant for. Tell me what the occasion is and we will design the box together.',
  weddingsTitle: 'Wedding favours, made for your day',
  weddingsText: 'Favours for every guest, a centrepiece for the dessert table, or thank-you boxes for the people who made the day happen. Colours, flavours and wording are chosen with you.',
  weddingsPoints: [
    { title: 'Matched to your colours', text: 'Boxes, ribbons and decoration chosen to sit with your theme.' },
    { title: 'Names and dates', text: 'Your initials, names or wedding date on the chocolates or the boxes.' },
    { title: 'Flavours you love', text: 'Choose from favourites or ask for something of your own.' },
    { title: 'Ready for the venue', text: 'Collected, or delivered to the venue if it is within reach.' }
  ],
  bespokeTitle: 'Bespoke chocolates, designed with you',
  bespokeText: 'If you can picture it, ask. Shapes, colours, lettering, logos and flavours are all chosen with you, then made by hand for your date.',
  faq: [
    { q: 'How far ahead should I order?', a: 'As early as you can, especially for weddings and large orders. Send your date and you will hear straight away whether it is free.' },
    { q: 'Can you cater for allergies?', a: 'Tell me about any allergies when you enquire or order. Every product lists its allergens, every box comes with a full ingredients list with allergens in bold, and I will go through it with you before you confirm.' },
    { q: 'How long do the chocolates keep?', a: 'Handmade chocolates are best eaten fresh. Each box is labelled with its best-before date and how to store it.' },
    { q: 'Do you deliver?', a: 'Collection is always possible. Delivery options and prices are shown at checkout and on the delivery page.' },
    { q: 'Can I cancel or change an order?', a: 'Because every order is made fresh and often personalised, orders can only be changed or cancelled before work on them has started. Get in touch as soon as you can.' }
  ],
  allergenStatement: 'Every product lists the allergens it contains. If you have an allergy or intolerance, please get in touch before ordering so we can talk it through.',
  allergenConfirmed: false,
  contact: { email: '', phone: '', area: '', address: '', hours: '', instagram: '', facebook: '', tiktok: '' },
  legal: { tradingName: '', ownerName: '', address: '', companyNumber: '', vatNumber: '' },
  delivery: {
    collect: { on: true, fee: 0, text: 'Collect your order at an agreed time. The address is sent with your order confirmation.' },
    local: { on: false, fee: 0, text: 'Local delivery to your door or venue.' },
    post: { on: false, fee: 0, text: 'Tracked UK delivery in insulated packaging. Not available in very hot weather.' }
  },
  noticeDays: 7,
  shopOpen: true,
  closedMessage: 'The shop is closed for a short break. Bespoke enquiries are still welcome.',
  alertEmail: '',
  keepMessagesMonths: 24
};

async function seed(env) {
  const now = Date.now();
  const drafts = [
    ['Box of handmade chocolates', 'Boxes', 'A gift box of handmade chocolates in mixed flavours.'],
    ['Personalised chocolate gift box', 'Gifts', 'A box finished with a name, initials or a short message.'],
    ['Wedding favour boxes', 'Weddings', 'Small favour boxes for your guests, sold in sets.'],
    ['Chocolate bar', 'Bars', 'A handmade chocolate bar.']
  ];
  const st = [env.DB.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind('content', JSON.stringify(DEFAULT_CONTENT))];
  drafts.forEach(([name, cat, summary], i) => st.push(env.DB.prepare('INSERT OR IGNORE INTO products (id, slug, name, category, summary, sort, updated) VALUES (?, ?, ?, ?, ?, ?, ?)').bind('p' + randomHex(6), ['box-of-handmade-chocolates', 'personalised-gift-box', 'wedding-favour-boxes', 'chocolate-bar'][i], name, cat, summary, i, now)));
  [['stock:melted', 'Melted dark chocolate'], ['stock:pralines', 'Hazelnut pralines'], ['stock:dome', 'A glossy chocolate dome']].forEach(([p, c], i) => st.push(env.DB.prepare('INSERT OR IGNORE INTO gallery (id, photo, caption, sort, created) VALUES (?, ?, ?, ?, ?)').bind('g' + i, p, c, i, now)));
  st.push(env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('seeded', '1')"));
  await env.DB.batch(st);
}

let contentCache = null, contentAt = 0;
export async function getContent(env, fresh = false) {
  if (!fresh && contentCache && Date.now() - contentAt < 5000) return contentCache;
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'content'").first();
  let c = {}; try { c = JSON.parse(row ? row.value : '{}'); } catch {}
  const merged = { ...DEFAULT_CONTENT, ...c, contact: { ...DEFAULT_CONTENT.contact, ...(c.contact || {}) }, legal: { ...DEFAULT_CONTENT.legal, ...(c.legal || {}) }, delivery: { ...DEFAULT_CONTENT.delivery, ...(c.delivery || {}) } };
  for (const k of ['collect', 'local', 'post']) merged.delivery[k] = { ...DEFAULT_CONTENT.delivery[k], ...(merged.delivery[k] || {}) };
  contentCache = merged; contentAt = Date.now();
  return merged;
}
export async function saveContent(env, c) { await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('content', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(c)).run(); contentCache = null; }

export const productRow = r => r && ({ ...r, allergens: safeArr(r.allergens), published: !!r.published, sold_out: !!r.sold_out, allergens_checked: !!r.allergens_checked });
export const safeArr = s => { try { const a = JSON.parse(s); return Array.isArray(a) ? a : []; } catch { return []; } };
export async function publicProducts(env) {
  const { results } = await env.DB.prepare('SELECT * FROM products WHERE published = 1 AND price > 0 AND allergens_checked = 1 ORDER BY sort, name').all();
  return results.map(productRow);
}
export async function hasPosts(env) { return !!(await env.DB.prepare('SELECT 1 FROM posts WHERE published = 1 LIMIT 1').first()); }

/* ---------- stand-in photographs (served from this site, so visitors' browsers never contact another server) ---------- */
export const STOCK = {
  melted: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/43/%22_13_ITALY_Chocolate_melted_-_italian_premium_chocolate_top_quality.JPG/1920px-%22_13_ITALY_Chocolate_melted_-_italian_premium_chocolate_top_quality.JPG', w: 1920, h: 1440, alt: 'A wooden spoon coated in melted dark chocolate over a bowl', credit: 'Andrea Pavanello', licence: 'CC BY-SA 3.0', page: 'https://commons.wikimedia.org/wiki/File:%22_13_ITALY_Chocolate_melted_-_italian_premium_chocolate_top_quality.JPG' },
  pralines: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/90/2023_Pralinki_Je%C5%BCyki_Coolki_%282%29.jpg/1280px-2023_Pralinki_Je%C5%BCyki_Coolki_%282%29.jpg', w: 1280, h: 705, alt: 'Three hazelnut-studded chocolate pralines in a row', credit: 'Jacek Halicki', licence: 'CC BY-SA 4.0', page: 'https://commons.wikimedia.org/wiki/File:2023_Pralinki_Je%C5%BCyki_Coolki_(2).jpg' },
  dome: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/06/Aldea_dessert_plating.jpg/1280px-Aldea_dessert_plating.jpg', w: 1280, h: 853, alt: 'A glossy dark chocolate dome on a slate tile', credit: 'Edsel Little', licence: 'CC BY-SA 2.0', page: 'https://commons.wikimedia.org/wiki/File:Aldea_dessert_plating.jpg' }
};
export const photoUrl = p => !p ? '' : p.startsWith('stock:') ? (STOCK[p.slice(6)] ? '/photos/stock/' + p.slice(6) + '.jpg' : '') : /^[a-z0-9]{8,40}$/.test(p) ? '/photos/' + p + '.jpg' : '';
export const photoAlt = (p, fallback) => p && p.startsWith('stock:') && STOCK[p.slice(6)] ? STOCK[p.slice(6)].alt : fallback || '';
