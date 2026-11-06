// Public pages, rendered on the server. Everything printed from the database or a visitor is escaped with esc().
import { esc, money, niceDate, prettyPhone, todayUK, addDays } from './lib.js';
import { ALLERGENS, OCCASIONS, STOCK, photoUrl, photoAlt } from './db.js';

const V = '9';
const A = href => href; // internal links

/* ---------- layout ---------- */
export function layout(c, { title, desc = '', path = '/', body, basketCount = 0, journal = false, noindex = false, canonical = '' }) {
  const name = c.name;
  const nav = [['/shop/', 'Shop'], ['/bespoke/', 'Bespoke'], ['/weddings/', 'Weddings'], ['/gallery/', 'Gallery'], ...(journal ? [['/journal/', 'Journal']] : []), ['/contact/', 'Contact']];
  const navLinks = nav.map(([h, t]) => `<a href="${h}"${path.startsWith(h) ? ' aria-current="page"' : ''}>${t}</a>`).join('');
  const basket = `<a class="basket-link" href="/basket/" aria-label="Basket, ${basketCount} ${basketCount === 1 ? 'item' : 'items'}">Basket<span class="basket-n"${basketCount ? '' : ' hidden'}>${basketCount}</span></a>`;
  const ct = c.contact || {};
  const social = [['instagram', 'Instagram'], ['facebook', 'Facebook'], ['tiktok', 'TikTok']].filter(([k]) => /^https:\/\/[^\s"<>]+$/.test(ct[k] || '')).map(([k, t]) => `<a href="${esc(ct[k])}" rel="noopener">${t}</a>`).join('');
  const usedStock = Object.entries(STOCK).filter(([k]) => body.includes('/photos/stock/' + k + '.jpg'));
  const credits = usedStock.length ? `<p class="foot__small">Photographs: ${usedStock.map(([, s]) => `<a href="${esc(s.page)}" rel="noopener">${esc(s.credit)}</a> (${esc(s.licence)})`).join(', ')}, via Wikimedia Commons.</p>` : '';
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title ? title + ' | ' + name : name)}</title>
<meta name="description" content="${esc(desc || c.heroText)}">
${noindex ? '<meta name="robots" content="noindex">' : ''}${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
<meta name="theme-color" content="#f3eee3">
<meta property="og:title" content="${esc(title || name)}">
<meta property="og:description" content="${esc(desc || c.heroText)}">
<meta property="og:type" content="website">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/assets/fonts/caslon-display.woff" as="font" type="font/woff" crossorigin>
<link rel="stylesheet" href="/assets/site.css?v=${V}">
<script src="/assets/site.js?v=${V}" defer></script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="page">
<header class="nav">
  <div class="container nav__in">
    <a class="wordmark" href="/">${esc(name)}</a>
    <nav class="nav__links" aria-label="Main">${navLinks}</nav>
    <div class="nav__end">${basket}
      <details class="menu"><summary aria-label="Menu"><span></span><span></span><span></span></summary><nav class="menu__panel" aria-label="Menu">${navLinks}<a href="/faq/">Questions</a><a class="btn" href="/bespoke/#enquire">Start an order</a></nav></details>
      <a class="btn btn--sm nav__cta" href="/bespoke/#enquire">Start an order</a>
    </div>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="foot">
  <div class="container foot__in">
    <div class="foot__top">
      <p class="foot__mark">${esc(name)}</p>
      <div class="foot__cols">
        <nav class="foot__links" aria-label="Shop and orders"><a href="/shop/">Shop</a><a href="/bespoke/">Bespoke orders</a><a href="/weddings/">Weddings</a><a href="/gallery/">Gallery</a>${journal ? '<a href="/journal/">Journal</a>' : ''}</nav>
        <nav class="foot__links" aria-label="Help"><a href="/delivery/">Delivery and collection</a><a href="/allergens/">Allergens</a><a href="/faq/">Questions</a><a href="/contact/">Contact</a></nav>
        <nav class="foot__links" aria-label="Legal"><a href="/terms/">Terms of sale</a><a href="/privacy/">Privacy</a>${social}</nav>
      </div>
    </div>
    ${ct.email ? `<p class="foot__small">Email <a href="mailto:${esc(ct.email)}">${esc(ct.email)}</a>${ct.phone ? ` or call <a href="tel:${esc(ct.phone)}">${esc(prettyPhone(ct.phone))}</a>` : ''}.</p>` : ''}
    <p class="foot__small">This site uses no tracking or advertising cookies. Card payments are handled securely by Stripe.</p>
    ${credits}
    <p class="foot__small">© ${new Date().getUTCFullYear()} ${esc(c.legal.tradingName || name)}. Website by <a href="https://nemora.uk" rel="noopener">NEMORA</a>.</p>
  </div>
</footer>
</div>
</body>
</html>`;
}

/* ---------- shared pieces ---------- */
export function picture(p, alt, { cls = '', eager = false, sizes = '' } = {}) {
  const u = photoUrl(p); if (!u) return '';
  const s = p.startsWith('stock:') ? STOCK[p.slice(6)] : null;
  return `<img src="${esc(u)}"${s ? ` width="${s.w}" height="${s.h}"` : ''} alt="${esc(photoAlt(p, alt))}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async"${cls ? ` class="${cls}"` : ''}>`;
}
const tile = (name, p, alt) => photoUrl(p) ? `<div class="photo__frame" data-slot>${picture(p, alt || name)}</div>` : `<div class="photo__frame tile" aria-hidden="true"><span>${esc(name.slice(0, 1))}</span></div>`;
const pageHead = (h1, lead, extra = '') => `<section class="head"><div class="container head__in"><h1>${esc(h1)}</h1>${lead ? `<p class="lead muted">${esc(lead)}</p>` : ''}${extra}</div></section>`;
const paras = t => String(t || '').split(/\n{2,}/).map(x => x.trim()).filter(Boolean).map(x => x.startsWith('## ') ? `<h2>${esc(x.slice(3))}</h2>` : `<p>${esc(x).replace(/\n/g, '<br>')}</p>`).join('');
const rows = items => `<ul class="rows">${items.map(i => `<li class="row"><h3>${esc(i.title)}</h3><p>${esc(i.text)}</p></li>`).join('')}</ul>`;
const steps = (list, title = 'How a custom order works') => `<section class="section band" id="how"><div class="container"><h2>${esc(title)}</h2><ol class="steps">${list.map((s, i) => `<li class="step"><span class="step__n">${i + 1}</span><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></li>`).join('')}</ol></div></section>`;
const faqList = list => `<div class="faq__list">${list.map(f => `<details class="q"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}</div>`;

export function productCard(p) {
  return `<li class="card"><a class="card__link" href="/shop/${esc(p.slug)}/">${tile(p.name, p.photo)}<span class="card__body"><span class="card__name">${esc(p.name)}</span><span class="card__price">${p.sold_out ? 'Sold out' : money(p.price)}</span></span></a></li>`;
}

/* ---------- enquiry form (used on home, bespoke, weddings and contact) ---------- */
export function enquiryForm({ token, values = {}, errors = [], preset = '', kind = 'full', source = '' }) {
  const v = k => esc(values[k] || '');
  const occ = values.occasion || preset;
  const err = errors.length ? `<div class="alert" role="alert" tabindex="-1" id="form-errors"><p>Please check the form:</p><ul>${errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
  const wedding = kind === 'wedding';
  const short = kind === 'short';
  return `<form class="form" method="post" action="/enquire/" novalidate data-enhance>
  ${err}
  <input type="hidden" name="t" value="${esc(token)}"><input type="hidden" name="source" value="${esc(source)}">
  <div class="hp" aria-hidden="true"><label for="f-website-${esc(source)}">Leave this empty</label><input id="f-website-${esc(source)}" name="website" tabindex="-1" autocomplete="off"></div>
  <div class="field"><label for="f-name-${esc(source)}">Your name</label><input id="f-name-${esc(source)}" name="name" type="text" autocomplete="name" maxlength="80" required value="${v('name')}"></div>
  <div class="field field--half"><label for="f-email-${esc(source)}">Email</label><input id="f-email-${esc(source)}" name="email" type="email" autocomplete="email" maxlength="120" required value="${v('email')}"></div>
  <div class="field field--half"><label for="f-phone-${esc(source)}">Phone <span class="opt">(optional)</span></label><input id="f-phone-${esc(source)}" name="phone" type="tel" autocomplete="tel" maxlength="30" value="${v('phone')}"></div>
  ${short ? `<input type="hidden" name="occasion" value="${esc(occ || 'Something else')}">` : `<div class="field"><label for="f-occ-${esc(source)}">What is it for?</label><select id="f-occ-${esc(source)}" name="occasion">${OCCASIONS.map(([o]) => `<option${o === occ ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></div>
  <div class="field field--half"><label for="f-date-${esc(source)}">${wedding ? 'Wedding date' : 'Date needed'} <span class="opt">(if you know it)</span></label><input id="f-date-${esc(source)}" name="event_date" type="date" min="${todayUK()}" value="${v('event_date')}"></div>
  <div class="field field--half"><label for="f-qty-${esc(source)}">${wedding ? 'Number of guests' : 'Roughly how many'} <span class="opt">(optional)</span></label><input id="f-qty-${esc(source)}" name="quantity" type="text" inputmode="numeric" maxlength="40" value="${v('quantity')}"></div>
  ${wedding ? `<div class="field field--half"><label for="f-venue-${esc(source)}">Venue <span class="opt">(optional)</span></label><input id="f-venue-${esc(source)}" name="venue" type="text" maxlength="120" value="${v('venue')}"></div><div class="field field--half"><label for="f-budget-${esc(source)}">Budget <span class="opt">(optional)</span></label><input id="f-budget-${esc(source)}" name="budget" type="text" maxlength="40" value="${v('budget')}"></div>` : ''}`}
  <div class="field"><label for="f-msg-${esc(source)}">${short ? 'Your message' : 'Tell me what you have in mind'}</label><textarea id="f-msg-${esc(source)}" name="message" rows="5" maxlength="4000" required>${v('message')}</textarea></div>
  ${short ? '' : `<div class="field"><label for="f-all-${esc(source)}">Allergies or dietary needs <span class="opt">(optional)</span></label><input id="f-all-${esc(source)}" name="allergies" type="text" maxlength="300" value="${v('allergies')}"></div>`}
  <p class="form__note">Your details are only used to reply to you and to make your order. They are never shared or used for marketing. <a href="/privacy/">Privacy notice</a>.</p>
  <button class="btn" type="submit">Send enquiry</button>
</form>`;
}

/* ---------- home ---------- */
export function homePage(c, { products, token, posts }) {
  const shop = products.length ? `<section class="section section--tight" id="shop-teaser"><div class="container"><div class="split-head"><h2>From the shop</h2><a class="link" href="/shop/">See everything in the shop</a></div><ul class="cards">${products.slice(0, 3).map(productCard).join('')}</ul></div></section>` : '';
  const journal = posts.length ? `<section class="section section--tight"><div class="container"><div class="split-head"><h2>From the journal</h2><a class="link" href="/journal/">All posts</a></div><ul class="posts">${posts.slice(0, 2).map(postCard).join('')}</ul></div></section>` : '';
  return `
  <section class="hero">
    <div class="hero__media" data-slot>${picture(c.heroPhoto, 'Handmade chocolates', { eager: true })}</div>
    <div class="container hero__in">
      <h1>${esc(c.heroTitle)}</h1>
      <p class="lead">${esc(c.heroText)}</p>
      <div class="actions">
        <a class="btn btn--light" href="/bespoke/#enquire">Start an order</a>
        ${products.length ? '<a class="link link--light" href="/shop/">Shop chocolates</a>' : '<a class="link link--light" href="#make">See what I make</a>'}
      </div>
    </div>
  </section>
  <section class="section" id="make">
    <div class="container make">
      <div class="make__head">
        <h2>What I make</h2>
        <p class="lead muted">${esc(c.makeIntro)}</p>
        ${photoUrl(c.makePhoto) ? `<figure class="photo"><div class="photo__frame photo__frame--wide" data-slot>${picture(c.makePhoto, 'Handmade chocolates')}</div></figure>` : ''}
      </div>
      ${rows(c.makeItems)}
    </div>
  </section>
  ${shop}
  ${steps(c.steps)}
  <section class="section" id="order">
    <div class="container order">
      <div class="order__intro">
        <h2>Start an order</h2>
        <p class="lead muted">Send the details and I’ll reply with ideas and a price. Nothing is booked until you say yes.</p>
        ${photoUrl(c.orderPhoto) ? `<figure class="photo order__photo"><div class="photo__frame" data-slot>${picture(c.orderPhoto, 'Handmade chocolates')}</div></figure>` : ''}
      </div>
      ${enquiryForm({ token, source: 'home' })}
    </div>
  </section>
  ${journal}
  <section class="section section--tight" id="questions">
    <div class="container faq">
      <div><h2>Questions</h2><p class="muted"><a class="link" href="/faq/">All questions</a></p></div>
      ${faqList(c.faq.slice(0, 4))}
    </div>
  </section>`;
}

/* ---------- shop ---------- */
export function shopPage(c, { products, cat }) {
  if (!c.shopOpen) return pageHead('Shop', c.closedMessage, '<div class="actions"><a class="btn" href="/bespoke/#enquire">Make a bespoke enquiry</a></div>');
  if (!products.length) return pageHead('Shop', 'The shop is being stocked. Bespoke orders are open now.', '<div class="actions"><a class="btn" href="/bespoke/#enquire">Make a bespoke enquiry</a></div>');
  const cats = [...new Set(products.map(p => p.category).filter(Boolean))];
  const shown = cat ? products.filter(p => p.category === cat) : products;
  const filter = cats.length > 1 ? `<nav class="chips" aria-label="Categories"><a href="/shop/"${!cat ? ' aria-current="page"' : ''}>Everything</a>${cats.map(k => `<a href="/shop/?c=${encodeURIComponent(k)}"${k === cat ? ' aria-current="page"' : ''}>${esc(k)}</a>`).join('')}</nav>` : '';
  return pageHead('Shop', `Handmade to order. Choose your date at checkout, with at least ${c.noticeDays} days’ notice.`, filter) +
    `<section class="section section--flush"><div class="container"><ul class="cards cards--shop">${shown.map(productCard).join('')}</ul>
    <aside class="note-band"><h2>Want something that isn’t here?</h2><p class="muted">Most orders are made to your own design.</p><a class="btn" href="/bespoke/#enquire">Ask about a bespoke order</a></aside></div></section>`;
}

export function productPage(c, p, { added = false, error = '' } = {}) {
  const has = ALLERGENS.filter(([k]) => p.allergens.includes(k)).map(a => a[1]);
  const notice = Math.max(c.noticeDays, p.notice_days || 0);
  return `<section class="section section--flush product"><div class="container product__in">
    <div class="product__media">${photoUrl(p.photo) ? `<div class="photo__frame product__frame" data-slot>${picture(p.photo, p.name, { eager: true })}</div>` : `<div class="photo__frame product__frame tile" aria-hidden="true"><span>${esc(p.name.slice(0, 1))}</span></div>`}</div>
    <div class="product__info">
      <p class="crumbs"><a href="/shop/">Shop</a>${p.category ? ` / <a href="/shop/?c=${encodeURIComponent(p.category)}">${esc(p.category)}</a>` : ''}</p>
      <h1>${esc(p.name)}</h1>
      <p class="product__price">${money(p.price)}</p>
      ${p.summary ? `<p class="lead">${esc(p.summary)}</p>` : ''}
      ${added ? `<p class="ok" role="status">Added to your basket. <a href="/basket/">View basket</a></p>` : ''}${error ? `<p class="alert" role="alert">${esc(error)}</p>` : ''}
      ${p.sold_out || !c.shopOpen ? `<p class="alert">${p.sold_out ? 'This is sold out at the moment.' : esc(c.closedMessage)}</p>` : `<form class="buy" method="post" action="/basket/">
        <input type="hidden" name="action" value="add"><input type="hidden" name="id" value="${esc(p.id)}">
        <div class="qty"><label for="qty">Quantity</label><input id="qty" name="qty" type="number" inputmode="numeric" min="1" max="${p.max_qty || 20}" value="1"></div>
        <button class="btn" type="submit">Add to basket</button>
      </form>`}
      <p class="muted small">Made to order: choose a date at least ${notice} days ahead at checkout.</p>
      <div class="allergen-box"><h2>Allergens</h2>${has.length ? `<p>Contains: <strong>${has.map(esc).join(', ')}</strong>.</p>` : '<p>Contains none of the 14 major allergens.</p>'}${p.may_contain ? `<p>May contain: ${esc(p.may_contain)}.</p>` : ''}<p class="small"><a href="/allergens/">Allergen information</a></p></div>
      ${p.description ? `<div class="prose">${paras(p.description)}</div>` : ''}
      ${p.ingredients ? `<details class="q"><summary>Ingredients</summary><p>${esc(p.ingredients)}</p></details>` : ''}
      <details class="q"><summary>Delivery and collection</summary><p>${deliverySummary(c)} <a href="/delivery/">More about delivery</a>.</p></details>
    </div>
  </div></section>`;
}
export function deliverySummary(c) {
  const d = c.delivery, out = [];
  if (d.collect.on) out.push('Collection' + (d.collect.fee ? ' (' + money(d.collect.fee) + ')' : ' (free)'));
  if (d.local.on) out.push('local delivery (' + (d.local.fee ? money(d.local.fee) : 'free') + ')');
  if (d.post.on) out.push('UK delivery (' + (d.post.fee ? money(d.post.fee) : 'free') + ')');
  return esc(out.length ? out.join(', ').replace(/^./, x => x.toUpperCase()) + '.' : 'Ask about collection and delivery.');
}

/* ---------- basket and checkout ---------- */
export function basketPage(c, { lines, subtotal, problems = [] }) {
  if (!lines.length) return pageHead('Your basket', 'Your basket is empty.', '<div class="actions"><a class="btn" href="/shop/">Go to the shop</a><a class="link" href="/bespoke/">Or ask about a bespoke order</a></div>');
  return pageHead('Your basket', '') + `<section class="section section--flush"><div class="container basket">
    ${problems.length ? `<div class="alert" role="alert">${problems.map(p => `<p>${esc(p)}</p>`).join('')}</div>` : ''}
    <ul class="lines">${lines.map(l => `<li class="bline">
      <a class="bline__img" href="/shop/${esc(l.p.slug)}/">${tile(l.p.name, l.p.photo)}</a>
      <div class="bline__info"><a class="bline__name" href="/shop/${esc(l.p.slug)}/">${esc(l.p.name)}</a><span class="muted">${money(l.p.price)} each</span></div>
      <form class="bline__qty" method="post" action="/basket/"><input type="hidden" name="action" value="set"><input type="hidden" name="id" value="${esc(l.p.id)}"><label class="sr" for="q-${esc(l.p.id)}">Quantity of ${esc(l.p.name)}</label><input id="q-${esc(l.p.id)}" name="qty" type="number" inputmode="numeric" min="0" max="${l.p.max_qty || 20}" value="${l.qty}"><button class="btn btn--ghost btn--sm" type="submit">Update</button></form>
      <span class="bline__total">${money(l.p.price * l.qty)}</span>
      <form method="post" action="/basket/"><input type="hidden" name="action" value="remove"><input type="hidden" name="id" value="${esc(l.p.id)}"><button class="linkbtn" type="submit">Remove<span class="sr"> ${esc(l.p.name)}</span></button></form>
    </li>`).join('')}</ul>
    <div class="basket__sum"><p class="sumrow"><span>Subtotal</span><strong>${money(subtotal)}</strong></p><p class="muted small">Delivery and your date are chosen at checkout.</p><a class="btn btn--block" href="/checkout/">Checkout</a><a class="link" href="/shop/">Keep shopping</a></div>
  </div></section>`;
}

export function checkoutPage(c, { lines, subtotal, minDate, values = {}, errors = [], token, payReady, cancelled }) {
  const v = k => esc(values[k] || '');
  const d = c.delivery;
  const opts = [['collect', 'Collection', d.collect], ['local', 'Local delivery', d.local], ['post', 'UK delivery', d.post]].filter(o => o[2].on);
  const chosen = values.fulfilment || (opts[0] && opts[0][0]);
  const legalMissing = !c.legal.tradingName || !c.contact.email || !c.legal.address;
  return pageHead('Checkout', '') + `<section class="section section--flush"><div class="container checkout">
  <form class="form checkout__form" method="post" action="/checkout/" novalidate data-enhance>
    ${cancelled ? '<p class="alert" role="status">Payment was cancelled, so nothing has been charged. You can try again below.</p>' : ''}
    ${errors.length ? `<div class="alert" role="alert" tabindex="-1" id="form-errors"><p>Please check the form:</p><ul>${errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
    <input type="hidden" name="t" value="${esc(token)}">
    <div class="hp" aria-hidden="true"><label for="c-website">Leave this empty</label><input id="c-website" name="website" tabindex="-1" autocomplete="off"></div>
    <fieldset class="field"><legend>How would you like it?</legend>
      <div class="choices">${opts.map(([k, t, o]) => `<label class="choice"><input type="radio" name="fulfilment" value="${k}"${k === chosen ? ' checked' : ''}><span><strong>${t}</strong> ${o.fee ? money(o.fee) : 'free'}<br><span class="muted small">${esc(o.text)}</span></span></label>`).join('')}</div>
    </fieldset>
    <div class="field"><label for="c-date">Date needed</label><input id="c-date" name="date_needed" type="date" min="${minDate}" required value="${v('date_needed')}"><span class="hint">The earliest date is ${esc(niceDate(minDate))}.</span></div>
    <div class="field"><label for="c-name">Full name</label><input id="c-name" name="name" autocomplete="name" maxlength="80" required value="${v('name')}"></div>
    <div class="field field--half"><label for="c-email">Email</label><input id="c-email" name="email" type="email" autocomplete="email" maxlength="120" required value="${v('email')}"></div>
    <div class="field field--half"><label for="c-phone">Phone</label><input id="c-phone" name="phone" type="tel" autocomplete="tel" maxlength="30" required value="${v('phone')}"></div>
    <div class="field address" data-address><label for="c-a1">Delivery address <span class="opt">(for delivery only)</span></label><input id="c-a1" name="address1" autocomplete="address-line1" maxlength="100" placeholder="House and street" value="${v('address1')}"><input name="address2" aria-label="Address line 2" autocomplete="address-line2" maxlength="100" value="${v('address2')}"><div class="address__row"><input name="town" aria-label="Town" autocomplete="address-level2" maxlength="60" placeholder="Town" value="${v('town')}"><input name="postcode" aria-label="Postcode" autocomplete="postal-code" maxlength="10" placeholder="Postcode" value="${v('postcode')}"></div></div>
    <div class="field"><label for="c-gift">Gift message or personalisation <span class="opt">(optional)</span></label><textarea id="c-gift" name="gift_message" rows="2" maxlength="300">${v('gift_message')}</textarea></div>
    <div class="field"><label for="c-notes">Allergies or anything else I should know <span class="opt">(optional)</span></label><textarea id="c-notes" name="notes" rows="2" maxlength="1000">${v('notes')}</textarea></div>
    <label class="check"><input type="checkbox" name="allergens_ok" value="yes"${values.allergens_ok ? ' checked' : ''}><span>I have read the <a href="/allergens/" target="_blank">allergen information</a> for everything in my basket.</span></label>
    <label class="check"><input type="checkbox" name="terms_ok" value="yes"${values.terms_ok ? ' checked' : ''}><span>I agree to the <a href="/terms/" target="_blank">terms of sale</a>. I understand made-to-order and personalised food can’t be returned once it has been made.</span></label>
    <button class="btn btn--block" type="submit">${payReady ? 'Continue to secure payment' : 'Send my order request'}</button>
    <p class="form__note">${payReady ? 'You’ll pay on Stripe’s secure page. Your card details never reach this site.' : 'Card payments are being set up. Send your order as a request and you’ll get a secure payment link by email once your date is confirmed.'}${legalMissing ? '' : ''}</p>
  </form>
  <aside class="summary"><h2>Your order</h2><ul class="sumlist">${lines.map(l => `<li><span>${l.qty} × ${esc(l.p.name)}</span><span>${money(l.p.price * l.qty)}</span></li>`).join('')}</ul>
    <p class="sumrow"><span>Subtotal</span><strong>${money(subtotal)}</strong></p>${opts.map(([k, t, o]) => `<p class="sumrow small muted" data-fee="${k}"><span>${t}</span><span>${o.fee ? money(o.fee) : 'free'}</span></p>`).join('')}
    <p class="small"><a href="/basket/">Change your basket</a></p></aside>
  </div></section>`;
}

export function orderDonePage(c, o, { requested }) {
  return pageHead(requested ? 'Order request sent' : 'Thank you for your order', requested ? 'You’ll get a reply by email to confirm your date, with a secure link to pay.' : 'Your payment went through and your order is booked in.') +
    `<section class="section section--flush"><div class="container narrow">
    <div class="panel"><p>Order reference <strong>${esc(o.ref)}</strong></p><ul class="sumlist">${o.items.map(i => `<li><span>${i.qty} × ${esc(i.name)}</span><span>${money(i.price * i.qty)}</span></li>`).join('')}</ul>
    ${o.delivery_fee ? `<p class="sumrow"><span>Delivery</span><span>${money(o.delivery_fee)}</span></p>` : ''}<p class="sumrow"><span>Total</span><strong>${money(o.total)}</strong></p>
    <p>${o.fulfilment === 'collect' ? 'Collection' : 'Delivery'} on <strong>${esc(niceDate(o.date_needed))}</strong>.</p></div>
    <p class="muted">Keep your order reference in case you need to get in touch. <a href="/contact/">Contact</a></p>
    <div class="actions"><a class="btn" href="/">Back to the home page</a></div></div></section>`;
}

/* ---------- bespoke and weddings ---------- */
export function bespokePage(c, { token, values, errors }) {
  return `<section class="head head--split"><div class="container split">
      <div class="split__text"><h1>${esc(c.bespokeTitle)}</h1><p class="lead muted">${esc(c.bespokeText)}</p><div class="actions"><a class="btn" href="#enquire">Start an enquiry</a><a class="link" href="/weddings/">Planning a wedding?</a></div></div>
      ${photoUrl(c.makePhoto) ? `<div class="photo__frame split__img" data-slot>${picture(c.makePhoto, 'Handmade chocolates', { eager: true })}</div>` : ''}
    </div></section>
    <section class="section section--tight"><div class="container make"><div class="make__head"><h2>Ideas to start from</h2><p class="lead muted">${esc(c.makeIntro)}</p></div>${rows(c.makeItems)}</div></section>
    ${steps(c.steps)}
    <section class="section" id="enquire"><div class="container order"><div class="order__intro"><h2>Start an enquiry</h2><p class="lead muted">The more you can tell me, the better: the date, how many, colours, flavours and any wording.</p><p class="muted">Orders need at least ${c.noticeDays} days’ notice, and more for weddings and large orders.</p></div>
      ${enquiryForm({ token, values, errors, preset: 'A bespoke design', source: 'bespoke' })}</div></section>`;
}
export function weddingsPage(c, { token, values, errors }) {
  return `<section class="hero hero--short">
      <div class="hero__media" data-slot>${picture(c.orderPhoto, 'Handmade chocolates', { eager: true })}</div>
      <div class="container hero__in"><h1>${esc(c.weddingsTitle)}</h1><p class="lead">${esc(c.weddingsText)}</p><div class="actions"><a class="btn btn--light" href="#enquire">Check your date</a></div></div>
    </section>
    <section class="section"><div class="container"><h2 class="mb">What’s included</h2><ul class="points">${c.weddingsPoints.map(p => `<li><h3>${esc(p.title)}</h3><p class="muted">${esc(p.text)}</p></li>`).join('')}</ul></div></section>
    ${steps(c.steps, 'From first message to the big day')}
    <section class="section" id="enquire"><div class="container order"><div class="order__intro"><h2>Check your date</h2><p class="lead muted">Send your date and guest numbers and you’ll get ideas and a price, with no obligation.</p></div>
      ${enquiryForm({ token, values, errors, preset: 'Wedding', kind: 'wedding', source: 'weddings' })}</div></section>`;
}
export function enquiryDonePage(c, { name }) {
  return pageHead('Thank you' + (name ? ', ' + name.split(' ')[0] : ''), 'Your message has arrived. You’ll get a reply by email, usually within a couple of days.', '<div class="actions"><a class="btn" href="/">Back to the home page</a><a class="link" href="/shop/">Browse the shop</a></div>');
}

/* ---------- gallery, journal ---------- */
export function galleryPage(c, items) {
  return pageHead('Gallery', 'A look at chocolates made for weddings, birthdays and gifts.') + `<section class="section section--flush"><div class="container">${items.length ? `<ul class="gallery">${items.map(g => `<li><figure><div class="photo__frame" data-slot>${picture(g.photo, g.caption)}</div>${g.caption ? `<figcaption>${esc(g.caption)}</figcaption>` : ''}</figure></li>`).join('')}</ul>` : '<p class="muted">Photos are coming soon.</p>'}
    <aside class="note-band"><h2>Like something you see?</h2><p class="muted">Every order can be made in your colours and flavours.</p><a class="btn" href="/bespoke/#enquire">Start an enquiry</a></aside></div></section>`;
}
const postCard = p => `<li class="post"><a href="/journal/${esc(p.slug)}/">${photoUrl(p.photo) ? `<div class="photo__frame photo__frame--wide" data-slot>${picture(p.photo, p.title)}</div>` : ''}<h3>${esc(p.title)}</h3>${p.summary ? `<p class="muted">${esc(p.summary)}</p>` : ''}<span class="small muted">${esc(niceDate(new Date(p.created).toISOString()))}</span></a></li>`;
export function journalPage(c, posts) { return pageHead('Journal', 'News, new flavours and ideas for your next occasion.') + `<section class="section section--flush"><div class="container"><ul class="posts">${posts.map(postCard).join('')}</ul></div></section>`; }
export function postPage(c, p) {
  return `<article class="section section--flush"><div class="container narrow"><p class="crumbs"><a href="/journal/">Journal</a></p><h1>${esc(p.title)}</h1><p class="muted">${esc(niceDate(new Date(p.created).toISOString()))}</p>
  ${photoUrl(p.photo) ? `<div class="photo__frame photo__frame--wide post__img" data-slot>${picture(p.photo, p.title, { eager: true })}</div>` : ''}<div class="prose">${paras(p.body)}</div>
  <aside class="note-band"><h2>Planning an occasion?</h2><a class="btn" href="/bespoke/#enquire">Start an enquiry</a></aside></div></article>`;
}

/* ---------- information pages ---------- */
export function allergensPage(c, products) {
  return pageHead('Allergen information', c.allergenStatement) + `<section class="section section--flush"><div class="container">
    ${products.length ? `<div class="tablewrap"><table class="atable"><caption>Allergens in each product (✓ means it contains that allergen)</caption><thead><tr><th scope="col">Product</th>${ALLERGENS.map(([, n]) => `<th scope="col"><span>${esc(n)}</span></th>`).join('')}<th scope="col">May contain</th></tr></thead><tbody>${products.map(p => `<tr><th scope="row"><a href="/shop/${esc(p.slug)}/">${esc(p.name)}</a></th>${ALLERGENS.map(([k, n]) => `<td>${p.allergens.includes(k) ? `<span aria-label="Contains ${esc(n)}">✓</span>` : '<span class="sr">No</span>'}</td>`).join('')}<td>${esc(p.may_contain)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="prose narrow-l"><h2>The 14 allergens</h2><p>UK law lists 14 allergens that must always be declared: ${ALLERGENS.map(a => esc(a[1].toLowerCase())).join(', ')}.</p><p>Every order comes with a full ingredients list, with allergens in bold. Bespoke orders are confirmed in writing before they are made, including the allergens they contain.</p><p>If you have an allergy or intolerance, <a href="/contact/">get in touch before ordering</a>.</p></div>
  </div></section>`;
}
export function deliveryPage(c) {
  const d = c.delivery;
  const opts = [['Collection', d.collect], ['Local delivery', d.local], ['UK delivery', d.post]].filter(o => o[1].on);
  return pageHead('Delivery and collection', `Everything is made fresh for your date, so orders need at least ${c.noticeDays} days’ notice.`) + `<section class="section section--flush"><div class="container">
    <ul class="points">${opts.map(([t, o]) => `<li><h3>${t}</h3><p class="price-sm">${o.fee ? money(o.fee) : 'Free'}</p><p class="muted">${esc(o.text)}</p></li>`).join('')}</ul>
    <div class="prose narrow-l"><h2>Looking after your chocolates</h2><p>Keep them somewhere cool and dry, away from sunlight and strong smells, and out of the fridge unless the label says otherwise. Each box is labelled with its best-before date.</p><h2>If something goes wrong</h2><p>If your order arrives damaged or isn’t what you ordered, <a href="/contact/">get in touch</a> within 48 hours with a photo and it will be put right.</p></div>
  </div></section>`;
}
export function faqPage(c) { return pageHead('Questions', '') + `<section class="section section--flush"><div class="container narrow">${faqList(c.faq)}<aside class="note-band"><h2>Still wondering?</h2><a class="btn" href="/contact/">Ask a question</a></aside></div></section>`; }
export function contactPage(c, { token, values, errors }) {
  const ct = c.contact;
  const details = [ct.email && `<li><span class="muted">Email</span><a href="mailto:${esc(ct.email)}">${esc(ct.email)}</a></li>`, ct.phone && `<li><span class="muted">Phone</span><a href="tel:${esc(ct.phone)}">${esc(prettyPhone(ct.phone))}</a></li>`, ct.area && `<li><span class="muted">Area</span><span>${esc(ct.area)}</span></li>`, ct.hours && `<li><span class="muted">Hours</span><span>${esc(ct.hours)}</span></li>`].filter(Boolean).join('');
  return `<section class="section"><div class="container order"><div class="order__intro"><h1>Get in touch</h1><p class="lead muted">Questions about an order, allergens or anything else. For a new order, the <a href="/bespoke/#enquire">bespoke enquiry form</a> asks the right questions.</p>${details ? `<ul class="details">${details}</ul>` : ''}</div>
    ${enquiryForm({ token, values, errors, kind: 'short', preset: 'Something else', source: 'contact' })}</div></section>`;
}

export function privacyPage(c) {
  const who = esc(c.legal.tradingName || c.name), email = c.contact.email;
  return pageHead('Privacy notice', 'How your details are used, kept and protected.') + `<section class="section section--flush"><div class="container narrow prose">
  <h2>Who is responsible for your data</h2><p>${who}${c.legal.ownerName ? ` (run by ${esc(c.legal.ownerName)})` : ''} is the data controller for information collected on this website.${email ? ` Contact: <a href="mailto:${esc(email)}">${esc(email)}</a>.` : ' Use the <a href="/contact/">contact page</a> to get in touch.'}</p>
  <h2>What is collected and why</h2><p><strong>Enquiries:</strong> your name, email, phone if you give it, details of your occasion and any allergies you mention, so your enquiry can be answered and quoted. The lawful basis is taking steps at your request before a contract, and, for allergy details, your explicit consent in giving them.</p>
  <p><strong>Orders:</strong> your name, email, phone, delivery address, date needed and order details, to make and deliver your order and keep the records the law requires. The lawful basis is the contract with you and legal obligations.</p>
  <p><strong>Payments:</strong> card payments are taken by Stripe on its own secure page. Card details never reach this website. Stripe’s privacy notice is at stripe.com/gb/privacy.</p>
  <p><strong>Visits:</strong> a simple count of which pages are viewed and which website sent the visitor. No cookies, IP addresses or other identifiers are stored, so visitors can’t be identified.</p>
  <h2>Cookies</h2><p>No tracking or advertising cookies are used. One cookie remembers what is in your basket while you shop, and is deleted when you check out or after 7 days. It is strictly necessary, so no consent banner is needed.</p>
  <h2>Who your data is shared with</h2><p>Only the services needed to run the shop: Cloudflare (website hosting and storage), Stripe (payments) and an email service for order emails. Your data is never sold or used for marketing.</p>
  <h2>How long it is kept</h2><p>Enquiries that don’t lead to an order are deleted after ${Number(c.keepMessagesMonths) || 24} months. Order and payment records are kept for 6 years, as tax law requires. Unpaid order attempts are deleted after 7 days.</p>
  <h2>Your rights</h2><p>You can ask to see, correct or delete your data, or object to how it is used. Ask through the contact details above. You also have the right to complain to the Information Commissioner’s Office at ico.org.uk.</p>
  <p class="muted small">Last updated ${esc(niceDate(todayUK()))}.</p></div></section>`;
}
export function termsPage(c) {
  const who = esc(c.legal.tradingName || c.name);
  const addr = c.legal.address ? esc(c.legal.address) : '';
  return pageHead('Terms of sale', 'The terms that apply when you order from this website.') + `<section class="section section--flush"><div class="container narrow prose">
  <h2>About us</h2><p>This shop is run by ${who}${c.legal.ownerName ? ` (${esc(c.legal.ownerName)})` : ''}${addr ? `, ${addr}` : ''}.${c.contact.email ? ` Email <a href="mailto:${esc(c.contact.email)}">${esc(c.contact.email)}</a>.` : ''}${c.legal.companyNumber ? ` Company number ${esc(c.legal.companyNumber)}.` : ''}${c.legal.vatNumber ? ` VAT number ${esc(c.legal.vatNumber)}.` : ''}</p>
  <h2>Orders</h2><p>Your order is accepted when your payment goes through, or for bespoke orders when you accept a written quote and pay. If your date can’t be met, you will be told straight away and refunded in full.</p>
  <h2>Prices and payment</h2><p>Prices are in pounds sterling. Delivery costs are shown before you pay. Payments are taken securely by Stripe.</p>
  <h2>Made-to-order and perishable food</h2><p>Everything is made to order, and much of it is personalised and perishable. Under the Consumer Contracts Regulations 2013, the 14-day right to cancel does not apply to goods made to your specification or goods that go off quickly. You can change or cancel an order free of charge until work on it has started.</p>
  <h2>If something is wrong</h2><p>Your rights under the Consumer Rights Act 2015 are not affected. If an order arrives damaged, faulty or not as described, contact us within 48 hours with a photo and it will be replaced or refunded.</p>
  <h2>Allergens</h2><p>Allergen information is shown for every product and confirmed in writing for bespoke orders. Please read it before ordering and tell us about any allergies.</p>
  <h2>Collection and delivery</h2><p>Delivery and collection options are shown at checkout and on the <a href="/delivery/">delivery page</a>. Please make sure someone is available to receive perishable orders.</p>
  <p class="muted small">Last updated ${esc(niceDate(todayUK()))}.</p></div></section>`;
}

/* ---------- payment links (quotes and order payments sent from the admin) ---------- */
export function payPage(c, p, { cancelled = false, payReady, token } = {}) {
  const paid = p.status === 'paid', expired = !paid && p.expires < Date.now();
  return pageHead(paid ? 'Paid, thank you' : 'Secure payment', '') + `<section class="section section--flush"><div class="container narrow"><div class="panel">
    <p class="muted">${esc(c.name)}</p><h2>${esc(p.description)}</h2><p class="product__price">${money(p.amount)}</p>
    ${paid ? `<p class="ok">This was paid on ${esc(niceDate(new Date(p.paid_at).toISOString()))}. Thank you.</p>` : expired || p.status === 'cancelled' ? '<p class="alert">This payment link has expired. Please get in touch for a new one.</p>' : payReady ? `${cancelled ? '<p class="alert">Payment was cancelled, so nothing has been charged.</p>' : ''}<form method="post"><input type="hidden" name="t" value="${esc(token)}"><button class="btn btn--block" type="submit">Pay ${money(p.amount)} securely</button></form><p class="form__note">You’ll pay on Stripe’s secure page. Your card details never reach this site.</p>` : '<p class="alert">Card payments aren’t switched on yet. Please get in touch to pay.</p>'}
  </div><p class="muted small">Questions? <a href="/contact/">Get in touch</a>.</p></div></section>`;
}

export function notFound() { return pageHead('Page not found', 'That page doesn’t exist, or has moved.', '<div class="actions"><a class="btn" href="/">Home</a><a class="link" href="/shop/">Shop</a></div>'); }
export function errorPage(msg) { return pageHead('Something went wrong', msg || 'Please try again in a moment.', '<div class="actions"><a class="btn" href="/">Home</a></div>'); }
