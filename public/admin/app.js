// Shop admin. Everything is built with DOM methods and textContent, so nothing a customer types can run as code.
(function () {
  'use strict';
  const $app = document.getElementById('app');
  const state = { user: null, content: null, unread: 0, inbox: { section: '', status: 'open', q: '', open: null } };

  /* ---------- helpers ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'hidden' || k === 'open' || k === 'required') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat(9)) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
    return el;
  }
  const put = (el, ...k) => el.replaceChildren(...k.flat(9).filter(x => x != null && x !== false).map(x => x.nodeType ? x : document.createTextNode(String(x))));
  const money = p => '£' + ((Number(p) || 0) / 100).toFixed(2);
  const pounds = p => p == null ? '' : ((Number(p) || 0) / 100).toFixed(2);
  const date = iso => iso ? new Date(String(iso).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
  const when = ms => { const d = new Date(ms), now = new Date(); const same = d.toDateString() === now.toDateString(); return same ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
  const full = ms => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const daysUntil = iso => Math.round((new Date(iso + 'T12:00:00Z') - new Date(new Date().toISOString().slice(0, 10) + 'T12:00:00Z')) / 86400000);
  function toast(msg) { document.querySelectorAll('.toast').forEach(t => t.remove()); const t = h('div', { class: 'toast', role: 'status' }, msg); document.body.append(t); setTimeout(() => t.remove(), 3200); }
  async function api(path, opts = {}) {
    const o = { method: opts.method || 'GET', headers: { 'X-Requested-With': 'choc' }, credentials: 'same-origin' };
    if (opts.body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opts.body); }
    const r = await fetch('/admin/api/' + path, o);
    let d = {}; try { d = await r.json(); } catch {}
    if (r.status === 401 && d.login) { state.user = null; renderLogin(); throw new Error('Please log in again.'); }
    if (!r.ok) throw new Error(d.error || 'Something went wrong. Please try again.');
    return d;
  }
  function busy(btn, fn) { return async (e) => { if (e) e.preventDefault(); if (btn.disabled) return; const t = btn.textContent; btn.disabled = true; try { await fn(); } catch (err) { toast(err.message); } finally { btn.disabled = false; if (btn.textContent === 'Saving…') btn.textContent = t; } }; }
  const field = (label, input, hint) => h('label', { class: 'f' }, label, input, hint ? h('span', { class: 'hint' }, hint) : null);
  const icon = d => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8'); s.setAttribute('aria-hidden', 'true'); const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.append(p); return s; };
  const ICONS = { home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z', inbox: 'M3 13l3-8h12l3 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM3 13h5l1 3h6l1-3h5', orders: 'M6 3h12l1 4H5zM5 7h14v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1zM9 11h6', products: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', more: 'M5 12h.01M12 12h.01M19 12h.01' };
  async function resizePhoto(file) {
    if (!/^image\//.test(file.type)) throw new Error('Choose a photo.');
    if (file.size > 25 * 1024 * 1024) throw new Error('That photo is too large.');
    const img = await createImageBitmap(file).catch(() => { throw new Error('That photo could not be opened. Try a JPEG or PNG.'); });
    const max = 1600, s = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    // re-drawing the photo drops its hidden data, including any GPS location
    let q = 0.86, data = c.toDataURL('image/jpeg', q);
    while (data.length > 2.2e6 && q > 0.5) { q -= 0.08; data = c.toDataURL('image/jpeg', q); }
    return { data, w: c.width, h: c.height };
  }
  async function uploadPhoto(file) { const p = await resizePhoto(file); const r = await api('photos', { method: 'POST', body: p }); return r.id; }
  const photoSrc = p => !p ? '' : p.startsWith('stock:') ? '/photos/stock/' + p.slice(6) + '.jpg' : '/photos/' + p + '.jpg';
  function photoPicker(value, onChange, { stock = true } = {}) {
    let cur = value || '';
    const pv = h('div', { class: 'pv' });
    const draw = () => { put(pv, cur ? h('img', { src: photoSrc(cur), alt: '', class: 'pv' }) : h('span', null, 'No photo')); };
    const file = h('input', { type: 'file', accept: 'image/*', class: 'sr', id: 'f' + Math.random().toString(36).slice(2) });
    const lbl = h('label', { class: 'btn ghost small', for: file.id }, cur ? 'Change photo' : 'Upload a photo');
    file.addEventListener('change', async () => { if (!file.files[0]) return; lbl.textContent = 'Uploading…'; try { cur = await uploadPhoto(file.files[0]); draw(); onChange(cur); lbl.textContent = 'Change photo'; } catch (e) { toast(e.message); lbl.textContent = 'Upload a photo'; } file.value = ''; });
    const rm = h('button', { type: 'button', class: 'link small', onclick: () => { cur = ''; draw(); onChange(''); } }, 'Remove');
    draw();
    return h('div', { class: 'photo-pick' }, pv, h('div', { class: 'stack-s' }, h('div', { class: 'row' }, file, lbl, rm), stock ? h('span', { class: 'small muted' }, 'Photos are resized and their location data removed before upload.') : null));
  }

  /* ---------- login and setup ---------- */
  async function boot() {
    try { const me = await api('me'); state.user = me.user; if (!me.user) return me.needsSetup ? renderSetup() : renderLogin(); route(); }
    catch (e) { put($app, h('p', { class: 'boot' }, e.message)); }
  }
  function renderLogin(msg) {
    const u = h('input', { name: 'username', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true });
    const p = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true });
    const err = h('p', { class: 'err', role: 'alert', hidden: !msg }, msg || '');
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Log in');
    const f = h('form', { novalidate: true }, h('h1', null, 'Shop admin'), err, field('Username', u), field('Password', p), btn);
    f.addEventListener('submit', busy(btn, async () => { err.hidden = true; try { const r = await api('login', { method: 'POST', body: { username: u.value, password: p.value } }); state.user = r.user; p.value = ''; location.hash = '#home'; route(); } catch (e) { err.textContent = e.message; err.hidden = false; p.value = ''; p.focus(); } }));
    put($app, h('div', { class: 'auth' }, f)); u.focus();
  }
  function renderSetup() {
    const code = h('input', { autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' });
    const u = h('input', { autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false' });
    const p = h('input', { type: 'password', autocomplete: 'new-password' });
    const p2 = h('input', { type: 'password', autocomplete: 'new-password' });
    const err = h('p', { class: 'err', role: 'alert', hidden: true });
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Create my login');
    const f = h('form', { novalidate: true }, h('h1', null, 'Set up your admin'), h('p', { class: 'muted' }, 'Enter the one-time setup code you were given, then choose your own username and password.'), err, field('Setup code', code), field('Username', u, 'Letters and numbers, at least 3.'), field('Password', p, 'At least 10 characters. A few random words works well.'), field('Password again', p2), btn);
    f.addEventListener('submit', busy(btn, async () => { err.hidden = true; if (p.value !== p2.value) { err.textContent = 'The two passwords are different.'; err.hidden = false; return; } try { const r = await api('setup', { method: 'POST', body: { code: code.value, username: u.value, password: p.value } }); state.user = r.user; location.hash = '#home'; route(); } catch (e) { err.textContent = e.message; err.hidden = false; } }));
    put($app, h('div', { class: 'auth' }, f)); code.focus();
  }

  /* ---------- shell ---------- */
  const NAV = [['home', 'Home'], ['messages', 'Messages'], ['orders', 'Orders'], ['products', 'Products'], ['gallery', 'Gallery'], ['journal', 'Journal'], ['website', 'Website'], ['payments', 'Payments'], ['settings', 'Settings']];
  function shell(active, ...content) {
    const tabs = h('nav', { class: 'tabs', 'aria-label': 'Admin' }, NAV.map(([k, t]) => h('a', { href: '#' + k, 'aria-current': active === k ? 'page' : null }, t, k === 'messages' && state.unread ? h('span', { class: 'badge' }, state.unread) : null)));
    const name = state.content ? state.content.name : 'Shop admin';
    const top = h('header', { class: 'top' }, h('div', { class: 'top__in' }, h('a', { class: 'brand', href: '#home' }, name), tabs, h('a', { class: 'btn ghost small', href: '/', target: '_blank', rel: 'noopener' }, 'View site')));
    const b = (k, t, ic) => h('a', { href: '#' + k, 'aria-current': active === k ? 'page' : null }, icon(ICONS[ic]), t, k === 'messages' && state.unread ? h('span', { class: 'badge' }, state.unread) : null);
    const moreActive = !['home', 'messages', 'orders', 'products'].includes(active);
    const bottom = h('nav', { class: 'bottom', 'aria-label': 'Admin' }, b('home', 'Home', 'home'), b('messages', 'Messages', 'inbox'), b('orders', 'Orders', 'orders'), b('products', 'Products', 'products'), h('button', { type: 'button', 'aria-current': moreActive ? 'page' : null, onclick: openMore }, icon(ICONS.more), 'More'));
    put($app, top, h('main', { class: 'view', id: 'main' }, ...content), bottom);
    window.scrollTo(0, 0);
  }
  function openMore() {
    const close = () => m.remove();
    const m = h('div', { class: 'more', onclick: e => { if (e.target === m) close(); } }, h('div', { class: 'more__panel', role: 'dialog', 'aria-label': 'More' },
      ...NAV.slice(4).map(([k, t]) => h('a', { href: '#' + k, onclick: close }, t, '›')), h('a', { href: '/', target: '_blank', rel: 'noopener', onclick: close }, 'View the website', '↗'), h('button', { type: 'button', onclick: close }, 'Close')));
    document.body.append(m);
    m.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    m.querySelector('a').focus();
  }
  async function refreshCounts() { try { const d = await api('dashboard'); state.unread = d.sections.reduce((s, x) => s + (x.unread || 0), 0); return d; } catch { return null; } }
  async function loadContent() { if (!state.content) { const r = await api('content'); state.content = r.content; state.stock = r.stock; } return state.content; }

  /* ---------- router ---------- */
  async function route() {
    if (!state.user) return;
    const [view, id] = (location.hash.slice(1) || 'home').split('/');
    try {
      await loadContent();
      if (view === 'messages') return messagesView(id);
      if (view === 'orders') return ordersView(id);
      if (view === 'products') return productsView(id);
      if (view === 'gallery') return galleryView();
      if (view === 'journal') return journalView(id);
      if (view === 'website') return websiteView();
      if (view === 'payments') return paymentsView();
      if (view === 'settings') return settingsView();
      return homeView();
    } catch (e) { if (state.user) shell(view, h('p', { class: 'err' }, e.message)); }
  }
  window.addEventListener('hashchange', route);

  /* ---------- home ---------- */
  async function homeView() {
    const [d, st] = await Promise.all([refreshCounts(), api('stats')]);
    const todo = d.checklist.filter(c => !c.done);
    const max = Math.max(1, ...st.days.map(x => x.n));
    const secRows = d.sections.map(s => h('li', null, h('a', { href: '#messages', onclick: () => { state.inbox.section = s.id; state.inbox.status = 'open'; } }, s.name), h('span', null, s.unread ? h('span', { class: 'badge' }, s.unread + ' new') : null, ' ', h('span', { class: 'muted small' }, (s.open || 0) + ' open'))));
    shell('home',
      h('div', { class: 'ph' }, h('div', null, h('h1', null, 'Hello' + (state.user ? ', ' + state.user : '')), h('p', null, new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })))),
      h('div', { class: 'cols' },
        h('section', { class: 'card' }, h('h2', null, 'Messages'), h('ul', { class: 'tlist' }, secRows), h('p', { class: 'small', style: null }, h('a', { href: '#messages' }, 'Open the inbox'))),
        h('section', { class: 'card' }, h('h2', null, 'Orders to make'), d.orders.length ? h('ul', { class: 'tlist' }, d.orders.map(o => h('li', null, h('a', { href: '#orders/' + o.id }, date(o.date_needed) + ' · ' + o.name), h('span', { class: 'pill ' + o.status }, o.status)))) : h('p', { class: 'muted' }, 'Nothing waiting. New orders appear here, soonest first.')),
        h('section', { class: 'card stack' }, h('h2', null, 'This month'), h('div', { class: 'grid2' }, h('div', { class: 'stat' }, h('span', { class: 'muted small' }, 'Shop orders paid'), h('b', null, money(d.month.orders)), h('span', { class: 'small muted' }, d.month.orderCount + ' orders')), h('div', { class: 'stat' }, h('span', { class: 'muted small' }, 'Quotes and deposits paid'), h('b', null, money(d.month.quotes)), h('span', { class: 'small muted' }, d.month.quoteCount + ' payments')))),
        h('section', { class: 'card stack' }, h('h2', null, 'Visits'), h('p', { class: 'muted small' }, d.visits7 + ' page views in the last 7 days. No cookies are used, so nobody is tracked.'), h('div', { class: 'bars', role: 'img', 'aria-label': 'Page views over the last 30 days' }, st.days.map(x => h('span', { style: null, title: date(x.day) + ': ' + x.n, 'data-h': Math.round(x.n / max * 100) }))),
          st.pages.length ? h('ul', { class: 'tlist' }, st.pages.slice(0, 5).map(p => h('li', null, h('span', null, p.path), h('span', null, p.n)))) : null,
          st.refs.length ? h('p', { class: 'small muted' }, 'Top referrers: ' + st.refs.slice(0, 4).map(r => r.ref + ' (' + r.n + ')').join(', ')) : null),
        todo.length ? h('section', { class: 'card' }, h('h2', null, 'Before you go live'), h('ul', { class: 'checklist' }, d.checklist.map(c => h('li', null, h('span', { class: 'dot' + (c.done ? ' on' : '') }), h('span', null, c.done ? c.text : h('a', { href: '#' + c.go }, c.text)))))) : null
      ));
    // bar heights set through CSSOM (no inline style attributes needed in the markup)
    document.querySelectorAll('.bars span').forEach(s => { s.style.height = Math.max(2, Number(s.dataset.h)) + '%'; });
  }

  /* ---------- messages ---------- */
  const STATUS_TEXT = { new: 'New', replied: 'Replied', quoted: 'Quoted', booked: 'Booked', paid: 'Paid', closed: 'Closed' };
  async function messagesView(openId) {
    const I = state.inbox;
    const q = new URLSearchParams(); if (I.section) q.set('section', I.section); if (I.status) q.set('status', I.status); if (I.q) q.set('q', I.q);
    const d = await api('messages?' + q.toString());
    state.unread = d.counts.reduce((s, c) => s + (c.unread || 0), 0);
    const count = id => d.counts.find(c => c.section === id) || { total: 0, unread: 0 };
    const allUnread = state.unread;
    const folderBtn = (id, name, n) => h('button', { type: 'button', 'aria-pressed': I.section === id ? 'true' : 'false', onclick: () => { I.section = id; location.hash = '#messages'; messagesView(); } }, name, n ? h('span', { class: 'badge' }, n) : null);
    const folders = h('nav', { class: 'folders', 'aria-label': 'Message sections' }, folderBtn('', 'All messages', allUnread), h('hr'), d.sections.map(s => folderBtn(s.id, s.name, count(s.id).unread)));
    const chip = (v, t) => h('button', { type: 'button', 'aria-pressed': I.status === v ? 'true' : 'false', onclick: () => { I.status = v; messagesView(openId); } }, t);
    const search = h('input', { class: 'inp', type: 'search', placeholder: 'Search names, emails or messages', value: I.q, 'aria-label': 'Search messages' });
    let t; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { I.q = search.value; messagesView(openId).then(() => { const s = document.querySelector('.mlist__tools input'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }); }, 350); });
    const secName = id => (d.sections.find(s => s.id === id) || {}).name || id;
    const list = d.messages.length ? h('ul', { class: 'items' }, d.messages.map(m => h('li', { class: m.unread ? 'unread' : '' }, h('button', { type: 'button', 'aria-current': m.id === openId ? 'true' : null, onclick: () => { location.hash = '#messages/' + m.id; } },
      h('span', { class: 'who' }, h('span', null, m.name), h('time', null, when(m.created))),
      h('span', { class: 'row' }, h('span', { class: 'pill ' + m.status }, STATUS_TEXT[m.status] || m.status), h('span', { class: 'meta' }, I.section ? m.occasion : secName(m.section)), m.event_date ? h('span', { class: 'meta' }, '· ' + date(m.event_date)) : null),
      h('span', { class: 'pre' }, m.preview))))) : h('p', { class: 'empty' }, I.q ? 'No messages match that search.' : 'No messages here yet.');
    const detail = h('section', { class: 'detail', 'aria-label': 'Message' }, h('p', { class: 'empty' }, 'Choose a message to read it.'));
    const box = h('div', { class: 'inbox' + (openId ? ' has-detail' : '') }, folders, h('div', { class: 'mlist' }, h('div', { class: 'mlist__tools' }, h('div', { class: 'chips', role: 'group', 'aria-label': 'Show' }, chip('open', 'Open'), chip('unread', 'Unread'), chip('done', 'Booked and closed'), chip('', 'All')), search), list), detail);
    shell('messages', h('div', { class: 'ph' }, h('div', null, h('h1', null, I.section ? secName(I.section) : 'Messages'), h('p', null, 'Enquiries are sorted into sections by what the customer picked. Move them if they land in the wrong place.'))), box);
    if (openId) await messageDetail(openId, detail, d);
  }
  async function messageDetail(id, el, listData) {
    let d; try { d = await api('messages/' + id); } catch (e) { put(el, h('p', { class: 'err' }, e.message)); return; }
    const m = d.message;
    const curLi = document.querySelector('.items button[aria-current="true"]'); if (curLi) curLi.closest('li').classList.remove('unread');
    state.unread = Math.max(0, state.unread - (listData.messages.find(x => x.id === id && x.unread) ? 1 : 0));
    const save = async patch => { await api('messages/' + id, { method: 'PATCH', body: patch }); };
    const sec = h('select', { class: 'inp', 'aria-label': 'Section', onchange: async () => { await save({ section: sec.value }); toast('Moved to ' + sec.selectedOptions[0].text); } }, d.sections.map(s => h('option', { value: s.id, selected: s.id === m.section }, s.name)));
    const st = h('select', { class: 'inp', 'aria-label': 'Status', onchange: async () => { await save({ status: st.value }); toast('Marked ' + STATUS_TEXT[st.value].toLowerCase()); } }, d.statuses.map(s => h('option', { value: s, selected: s === m.status }, STATUS_TEXT[s])));
    const notes = h('textarea', { class: 'inp', placeholder: 'Private notes: flavours agreed, price quoted, collection time…', value: m.notes });
    let nt; notes.addEventListener('input', () => { clearTimeout(nt); nt = setTimeout(() => save({ notes: notes.value }).then(() => toast('Notes saved')).catch(e => toast(e.message)), 800); });
    const first = m.name.split(' ')[0];
    const subject = 'Re: your ' + (m.occasion || 'enquiry').toLowerCase() + ' enquiry';
    const mailto = 'mailto:' + encodeURIComponent(m.email) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent('Hi ' + first + ',\n\nThank you for getting in touch.\n\n');
    const facts = [['Email', h('a', { href: 'mailto:' + m.email }, m.email)], m.phone && ['Phone', h('a', { href: 'tel:' + m.phone }, m.phone)], ['For', m.occasion], m.event_date && ['Date', date(m.event_date) + (daysUntil(m.event_date) >= 0 ? ' (in ' + daysUntil(m.event_date) + ' days)' : '')], m.quantity && ['How many', m.quantity], m.venue && ['Venue', m.venue], m.budget && ['Budget', m.budget], m.allergies && ['Allergies', h('strong', null, m.allergies)], ['Sent', full(m.created) + ' from the ' + (m.source || 'website') + ' page']].filter(Boolean);
    // payment link
    const amt = h('input', { class: 'inp', inputmode: 'decimal', placeholder: '0.00' });
    const desc = h('input', { class: 'inp', value: (m.occasion || 'Order') + ' chocolates for ' + m.name, maxlength: 120 });
    const days = h('select', { class: 'inp' }, [7, 14, 30].map(n => h('option', { value: n, selected: n === 14 }, n + ' days')));
    const note = h('textarea', { class: 'inp', placeholder: 'Optional message to go with the link' });
    const send = h('input', { type: 'checkbox', checked: true });
    const out = h('div', { class: 'stack-s' });
    const mk = h('button', { class: 'btn', type: 'button' }, 'Create payment link');
    mk.addEventListener('click', busy(mk, async () => {
      const r = await api('messages/' + id + '/link', { method: 'POST', body: { amount: amt.value, description: desc.value, days: days.value, note: note.value, send: send.checked } });
      put(out, copyBox(r.link), h('p', { class: 'okmsg' }, r.emailed ? 'Emailed to ' + m.email + '.' : 'Copy the link and send it to ' + first + '.'));
      st.value = m.status === 'new' || m.status === 'replied' ? 'quoted' : st.value;
    }));
    const links = d.links.length ? h('ul', { class: 'tlist' }, d.links.map(l => h('li', null, h('span', null, l.description + ' · ' + money(l.amount)), h('span', { class: 'pill ' + l.status }, l.status)))) : null;
    const del = h('button', { class: 'btn danger small', type: 'button' }, 'Delete message');
    del.addEventListener('click', () => confirmInline(del, 'Delete for good?', async () => { await api('messages/' + id, { method: 'DELETE' }); toast('Message deleted'); location.hash = '#messages'; }));
    put(el, 
      h('div', { class: 'row between' }, h('a', { class: 'btn ghost small back', href: '#messages' }, '‹ Back'), h('span', { class: 'muted small' }, full(m.created))),
      h('div', { class: 'stack-s' }, h('h2', null, m.name), h('dl', { class: 'kv' }, facts.map(([k, v]) => [h('dt', null, k), h('dd', null, v)]))),
      h('div', { class: 'detail__body' }, m.message),
      h('div', { class: 'row' }, h('a', { class: 'btn', href: mailto }, 'Reply by email'), m.phone ? h('a', { class: 'btn ghost', href: 'tel:' + m.phone }, 'Call') : null, h('button', { class: 'btn quiet', type: 'button', onclick: () => copy(m.email, 'Email address copied') }, 'Copy email')),
      h('div', { class: 'grid2' }, field('Status', st), field('Section', sec)),
      field('Notes', notes),
      h('details', { class: 'sec', open: !d.links.length && ['new', 'replied'].includes(m.status) ? null : null }, h('summary', null, 'Send a quote or deposit link'), h('div', null,
        d.payReady ? null : h('p', { class: 'err' }, 'Card payments are not switched on yet, so links will say “get in touch to pay”. Connect Stripe in Payments.'),
        h('div', { class: 'grid2' }, field('Amount (£)', amt), field('Link works for', days)), field('What it’s for', desc, 'The customer sees this on the payment page and their receipt.'), field('Message', note), h('label', { class: 'tick' }, send, h('span', null, 'Email the link to ' + m.email)), mk, out, links)),
      d.others.length ? h('div', { class: 'stack-s' }, h('h3', null, 'Earlier messages from ' + first), h('ul', { class: 'tlist' }, d.others.map(o => h('li', null, h('a', { href: '#messages/' + o.id }, o.occasion), h('span', { class: 'muted' }, when(o.created)))))) : null,
      h('div', { class: 'row' }, del)
    );
    const tabB = document.querySelectorAll('.badge'); if (!state.unread) tabB.forEach(b => { if (b.closest('a[href="#messages"]')) b.remove(); });
  }
  function copyBox(text) { const i = h('input', { value: text, readonly: true, 'aria-label': 'Link', onfocus: e => e.target.select() }); return h('div', { class: 'copybox' }, i, h('button', { class: 'btn small', type: 'button', onclick: () => copy(text, 'Link copied') }, 'Copy')); }
  async function copy(text, msg) { try { await navigator.clipboard.writeText(text); toast(msg); } catch { toast('Press and hold to copy'); } }
  function confirmInline(btn, q, fn) {
    const t = btn.textContent; btn.textContent = q;
    const yes = async () => { btn.removeEventListener('click', yes); try { await fn(); } catch (e) { toast(e.message); btn.textContent = t; } };
    btn.addEventListener('click', yes, { once: true });
    setTimeout(() => { if (btn.isConnected && btn.textContent === q) { btn.textContent = t; btn.removeEventListener('click', yes); } }, 4000);
  }

  /* ---------- orders ---------- */
  const ORDER_TEXT = { requested: 'Request (unpaid)', pending: 'Paying now', paid: 'Paid', making: 'Making', ready: 'Ready', done: 'Done', cancelled: 'Cancelled' };
  const FUL = { collect: 'Collection', local: 'Local delivery', post: 'UK delivery' };
  async function ordersView(id) {
    if (id) return orderDetail(id);
    const g = state.orderGroup || 'active';
    const d = await api('orders?status=' + g);
    const chip = (v, t) => h('button', { type: 'button', 'aria-pressed': g === v ? 'true' : 'false', onclick: () => { state.orderGroup = v; ordersView(); } }, t);
    const item = o => { const n = daysUntil(o.date_needed); return h('li', null, h('a', { class: 'li', href: '#orders/' + o.id }, h('div', { class: 'datebox' + (n <= 2 && g === 'active' ? ' soon' : '') }, h('b', null, new Date(o.date_needed + 'T12:00:00Z').getUTCDate()), h('span', null, new Date(o.date_needed + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }))), h('div', null, h('div', { class: 't' }, o.name + ' · ' + o.ref), h('div', { class: 's' }, o.items.map(i => i.qty + ' × ' + i.name).join(', ')), h('div', { class: 's' }, FUL[o.fulfilment] + ' · ' + money(o.total))), h('span', { class: 'pill ' + o.status }, ORDER_TEXT[o.status]))); };
    shell('orders', h('div', { class: 'ph' }, h('div', null, h('h1', null, 'Orders'), h('p', null, 'Shop orders, soonest date first. Bespoke orders are paid through quote links in Messages.'))),
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Show', style: null }, chip('active', 'To do'), chip('done', 'Done'), chip('cancelled', 'Cancelled'), chip('pending', 'Unfinished checkouts')),
      h('div', { style: null, class: 'stack', id: 'olist' }, d.orders.length ? h('ul', { class: 'list' }, d.orders.map(item)) : h('p', { class: 'empty' }, g === 'pending' ? 'Checkouts that were started but not paid show here. They delete themselves after 7 days.' : 'No orders here yet.')));
    document.getElementById('olist').style.marginTop = '12px';
  }
  async function orderDetail(id) {
    const d = await api('orders/' + id), o = d.order;
    const steps = ['requested', 'paid', 'making', 'ready', 'done'];
    const notify = h('input', { type: 'checkbox', checked: true });
    const setStatus = async s => { await api('orders/' + id, { method: 'PATCH', body: { status: s, notify: s === 'ready' && notify.checked } }); toast('Marked ' + ORDER_TEXT[s].toLowerCase()); orderDetail(id); };
    const stepBtns = h('div', { class: 'steps', role: 'group', 'aria-label': 'Order status' }, steps.filter(s => s !== 'requested' || o.status === 'requested').map(s => h('button', { type: 'button', 'aria-pressed': o.status === s ? 'true' : 'false', onclick: () => setStatus(s) }, ORDER_TEXT[s])));
    const notes = h('textarea', { class: 'inp', value: o.admin_notes, placeholder: 'Private notes' });
    let nt; notes.addEventListener('input', () => { clearTimeout(nt); nt = setTimeout(() => api('orders/' + id, { method: 'PATCH', body: { admin_notes: notes.value } }).then(() => toast('Notes saved')).catch(e => toast(e.message)), 800); });
    const linkOut = h('div', { class: 'stack-s' });
    const linkBtn = h('button', { class: 'btn', type: 'button' }, 'Send payment link for ' + money(o.total));
    linkBtn.addEventListener('click', busy(linkBtn, async () => { const r = await api('orders/' + id + '/link', { method: 'POST', body: { send: true } }); put(linkOut, copyBox(r.link), h('p', { class: 'okmsg' }, r.emailed ? 'Emailed to ' + o.email + '.' : 'Copy the link and send it to the customer.')); }));
    const cancel = h('button', { class: 'btn danger small', type: 'button' }, o.status === 'requested' || o.status === 'pending' ? 'Delete this request' : 'Mark cancelled');
    cancel.addEventListener('click', () => confirmInline(cancel, 'Are you sure?', async () => { if (o.status === 'requested' || o.status === 'pending') { await api('orders/' + id, { method: 'DELETE' }); location.hash = '#orders'; } else { await setStatus('cancelled'); } }));
    shell('orders',
      h('div', { class: 'ph' }, h('div', null, h('a', { class: 'btn ghost small', href: '#orders' }, '‹ All orders'), h('h1', null, o.name), h('p', null, 'Order ' + o.ref + ' · placed ' + full(o.created))), h('span', { class: 'pill ' + o.status }, ORDER_TEXT[o.status])),
      h('div', { class: 'cols' },
        h('section', { class: 'card stack' }, h('h2', null, 'What to make'), h('ul', { class: 'tlist' }, o.items.map(i => h('li', null, h('span', null, i.qty + ' × ' + i.name), h('span', null, money(i.price * i.qty)))), o.delivery_fee ? h('li', null, h('span', null, FUL[o.fulfilment]), h('span', null, money(o.delivery_fee))) : null, h('li', null, h('strong', null, 'Total'), h('strong', null, money(o.total)))),
          o.gift_message ? h('div', null, h('p', { class: 'muted small' }, 'Gift message or personalisation'), h('p', { class: 'detail__body' }, o.gift_message)) : null,
          o.notes ? h('div', null, h('p', { class: 'muted small' }, 'Allergies and notes from the customer'), h('p', { class: 'detail__body' }, o.notes)) : null),
        h('section', { class: 'card stack' }, h('h2', null, FUL[o.fulfilment] + ' on ' + date(o.date_needed)), h('dl', { class: 'kv' }, h('dt', null, 'Email'), h('dd', null, h('a', { href: 'mailto:' + o.email }, o.email)), h('dt', null, 'Phone'), h('dd', null, h('a', { href: 'tel:' + o.phone }, o.phone)), o.address ? [h('dt', null, 'Address'), h('dd', null, o.address)] : null, o.paid_at ? [h('dt', null, 'Paid'), h('dd', null, full(o.paid_at))] : null),
          h('div', { class: 'row' }, h('a', { class: 'btn ghost', href: 'mailto:' + o.email + '?subject=' + encodeURIComponent('Your order ' + o.ref) }, 'Email'), h('a', { class: 'btn ghost', href: 'tel:' + o.phone }, 'Call'))),
        h('section', { class: 'card stack' }, h('h2', null, 'Progress'), stepBtns, h('label', { class: 'tick' }, notify, h('span', null, 'Email the customer when I mark it ready')),
          o.status === 'requested' ? h('div', { class: 'stack-s' }, h('p', null, 'This is an order request: it has not been paid. Check the date works, then send a payment link.'), d.payReady ? linkBtn : h('p', { class: 'err' }, 'Connect Stripe in Payments to send card payment links.'), linkOut) : null,
          d.links.length ? h('ul', { class: 'tlist' }, d.links.map(l => h('li', null, h('span', null, money(l.amount) + ' link'), h('span', { class: 'pill ' + l.status }, l.status)))) : null,
          field('Notes', notes), h('div', null, cancel))));
  }

  /* ---------- products ---------- */
  async function productsView(id) {
    const d = await api('products');
    if (id) return productEditor(id === 'new' ? null : d.products.find(p => p.id === id), d.allergens);
    const move = async (i, dir) => { const ids = d.products.map(p => p.id); const j = i + dir; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; await api('products/order', { method: 'POST', body: { ids } }); productsView(); };
    shell('products', h('div', { class: 'ph' }, h('div', null, h('h1', null, 'Products'), h('p', null, 'Products show in the shop once they have a price, checked allergens and are published.')), h('a', { class: 'btn', href: '#products/new' }, 'Add a product')),
      d.products.length ? h('ul', { class: 'list' }, d.products.map((p, i) => h('li', { class: 'row', style: null }, h('a', { class: 'li', href: '#products/' + p.id }, p.photo ? h('img', { class: 'thumb', src: photoSrc(p.photo), alt: '' }) : h('span', { class: 'thumb' }, p.name.slice(0, 1)), h('div', null, h('div', { class: 't' }, p.name), h('div', { class: 's' }, [p.category, p.price ? money(p.price) : 'No price yet'].filter(Boolean).join(' · '))), h('span', { class: 'pill ' + (p.published && p.price && p.allergens_checked ? 'paid' : 'open') }, p.published && p.price && p.allergens_checked ? (p.sold_out ? 'Sold out' : 'In the shop') : 'Draft')),
        h('div', { class: 'row' }, h('button', { class: 'btn quiet small', type: 'button', 'aria-label': 'Move ' + p.name + ' up', onclick: () => move(i, -1), disabled: i === 0 }, '↑'), h('button', { class: 'btn quiet small', type: 'button', 'aria-label': 'Move ' + p.name + ' down', onclick: () => move(i, 1), disabled: i === d.products.length - 1 }, '↓'))))) : h('p', { class: 'empty' }, 'No products yet.'));
    document.querySelectorAll('.list > li.row').forEach(li => { li.style.flexWrap = 'nowrap'; li.firstChild.style.flex = '1'; });
  }
  function productEditor(p, allergens) {
    p = p || { name: '', category: '', price: null, summary: '', description: '', ingredients: '', allergens: [], may_contain: '', allergens_checked: false, photo: '', published: false, sold_out: false, notice_days: 0, max_qty: 20 };
    let photo = p.photo;
    const f = { name: h('input', { value: p.name, maxlength: 80 }), category: h('input', { value: p.category, maxlength: 40, list: 'cats' }), price: h('input', { value: pounds(p.price), inputmode: 'decimal', placeholder: '0.00' }), summary: h('input', { value: p.summary, maxlength: 200 }), description: h('textarea', { value: p.description }), ingredients: h('textarea', { value: p.ingredients }), may_contain: h('input', { value: p.may_contain, maxlength: 200, placeholder: 'e.g. traces of nuts' }), notice: h('input', { type: 'number', min: 0, max: 90, value: p.notice_days, inputmode: 'numeric' }), max: h('input', { type: 'number', min: 1, max: 50, value: p.max_qty, inputmode: 'numeric' }) };
    const checks = allergens.map(([k, n]) => h('label', { class: 'tick' }, h('input', { type: 'checkbox', value: k, checked: p.allergens.includes(k) }), h('span', null, n)));
    const checked = h('input', { type: 'checkbox', checked: p.allergens_checked });
    const pub = h('input', { type: 'checkbox', checked: p.published }), sold = h('input', { type: 'checkbox', checked: p.sold_out });
    const err = h('p', { class: 'err', role: 'alert', hidden: true });
    const save = h('button', { class: 'btn', type: 'submit' }, 'Save product');
    const form = h('form', { class: 'stack', novalidate: true },
      h('div', { class: 'ph' }, h('div', null, h('a', { class: 'btn ghost small', href: '#products' }, '‹ All products'), h('h1', null, p.id ? p.name : 'New product')), p.id && p.published ? h('a', { class: 'btn ghost small', href: '/shop/' + p.slug + '/', target: '_blank', rel: 'noopener' }, 'View in shop') : null),
      h('div', { class: 'cols' },
        h('section', { class: 'card stack' }, h('h2', null, 'Details'), field('Name', f.name), h('div', { class: 'grid2' }, field('Price (£)', f.price), field('Category', f.category, 'e.g. Boxes, Bars, Weddings')), field('One-line summary', f.summary), field('Description', f.description, 'Leave a blank line between paragraphs.'), h('div', { class: 'grid2' }, field('Extra notice (days)', f.notice, 'Added on top of your usual notice.'), field('Most per order', f.max))),
        h('section', { class: 'card stack' }, h('h2', null, 'Photo'), photoPicker(photo, v => { photo = v; })),
        h('section', { class: 'card stack' }, h('h2', null, 'Allergens'), h('p', { class: 'small muted' }, 'Tick every allergen this product contains. UK law requires this information for food sold online.'), h('div', { class: 'agrid' }, checks), field('May contain', f.may_contain), field('Full ingredients', f.ingredients, 'Shown on the product page. Put allergens in CAPITALS so they stand out.'), h('label', { class: 'tick' }, checked, h('span', null, h('strong', null, 'I have checked these allergens are correct')))),
        h('section', { class: 'card stack' }, h('h2', null, 'In the shop'), h('label', { class: 'tick' }, pub, h('span', null, 'Published (shows in the shop)')), h('label', { class: 'tick' }, sold, h('span', null, 'Sold out for now')), err, h('div', { class: 'row' }, save, p.id ? h('button', { class: 'btn danger', type: 'button', id: 'pdel' }, 'Delete') : null))),
      h('datalist', { id: 'cats' }, ['Boxes', 'Bars', 'Gifts', 'Weddings', 'Seasonal'].map(c => h('option', { value: c }))));
    form.addEventListener('submit', busy(save, async () => {
      err.hidden = true;
      const body = { name: f.name.value, category: f.category.value, price: f.price.value, summary: f.summary.value, description: f.description.value, ingredients: f.ingredients.value, may_contain: f.may_contain.value, notice_days: f.notice.value, max_qty: f.max.value, allergens: checks.map(c => c.querySelector('input')).filter(i => i.checked).map(i => i.value), allergens_checked: checked.checked, photo, published: pub.checked, sold_out: sold.checked };
      try { if (p.id) await api('products/' + p.id, { method: 'PUT', body }); else { const r = await api('products', { method: 'POST', body }); p.id = r.id; } toast('Product saved'); location.hash = '#products'; }
      catch (e) { err.textContent = e.message; err.hidden = false; err.scrollIntoView({ block: 'center' }); }
    }));
    shell('products', form);
    const del = document.getElementById('pdel');
    if (del) del.addEventListener('click', () => confirmInline(del, 'Delete for good?', async () => { await api('products/' + p.id, { method: 'DELETE' }); toast('Product deleted'); location.hash = '#products'; }));
  }

  /* ---------- gallery ---------- */
  async function galleryView() {
    const d = await api('gallery');
    const file = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'sr', id: 'gup' });
    const lbl = h('label', { class: 'btn', for: 'gup' }, 'Add photos');
    file.addEventListener('change', async () => { const files = [...file.files].slice(0, 20); let n = 0; for (const fl of files) { lbl.textContent = 'Uploading ' + (++n) + ' of ' + files.length + '…'; try { const id = await uploadPhoto(fl); await api('gallery', { method: 'POST', body: { photo: id, caption: '' } }); } catch (e) { toast(e.message); } } galleryView(); });
    const move = async (i, dir) => { const ids = d.items.map(g => g.id); const j = i + dir; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; await api('gallery/order', { method: 'POST', body: { ids } }); galleryView(); };
    shell('gallery', h('div', { class: 'ph' }, h('div', null, h('h1', null, 'Gallery'), h('p', null, 'Photos of your work. The first three are stand-in photos until you add your own.')), h('div', null, file, lbl)),
      d.items.length ? h('ul', { class: 'gal' }, d.items.map((g, i) => { const cap = h('input', { class: 'inp', value: g.caption, placeholder: 'Caption (optional)', 'aria-label': 'Caption', maxlength: 140 }); cap.addEventListener('change', () => api('gallery/' + g.id, { method: 'PATCH', body: { caption: cap.value } }).then(() => toast('Caption saved'))); const del = h('button', { class: 'btn danger small', type: 'button' }, 'Remove'); del.addEventListener('click', () => confirmInline(del, 'Sure?', async () => { await api('gallery/' + g.id, { method: 'DELETE' }); galleryView(); }));
        return h('li', null, h('img', { src: photoSrc(g.photo), alt: g.caption || '' }), h('div', { class: 'gtools' }, cap, h('div', { class: 'row between' }, h('div', { class: 'row' }, h('button', { class: 'btn quiet small', type: 'button', 'aria-label': 'Move earlier', onclick: () => move(i, -1), disabled: i === 0 }, '←'), h('button', { class: 'btn quiet small', type: 'button', 'aria-label': 'Move later', onclick: () => move(i, 1), disabled: i === d.items.length - 1 }, '→')), del))); })) : h('p', { class: 'empty' }, 'No photos yet.'));
  }

  /* ---------- journal ---------- */
  async function journalView(id) {
    const d = await api('posts');
    if (id) {
      const p = id === 'new' ? { title: '', summary: '', body: '', photo: '', published: false } : d.posts.find(x => x.id === id);
      if (!p) { location.hash = '#journal'; return; }
      let photo = p.photo;
      const t = h('input', { value: p.title, maxlength: 120 }), s = h('input', { value: p.summary, maxlength: 240 }), b = h('textarea', { value: p.body, rows: 14 }), pub = h('input', { type: 'checkbox', checked: !!p.published });
      const err = h('p', { class: 'err', hidden: true }), save = h('button', { class: 'btn', type: 'submit' }, 'Save post');
      const form = h('form', { class: 'stack card', novalidate: true }, h('a', { class: 'btn ghost small', href: '#journal' }, '‹ All posts'), h('h1', null, p.id ? 'Edit post' : 'New post'), field('Title', t), field('Short summary', s), field('Post', b, 'Leave a blank line between paragraphs. Start a line with ## for a heading.'), h('h2', null, 'Photo'), photoPicker(photo, v => { photo = v; }), h('label', { class: 'tick' }, pub, h('span', null, 'Published')), err, h('div', { class: 'row' }, save, p.id ? h('button', { class: 'btn danger', type: 'button', id: 'jdel' }, 'Delete') : null));
      form.addEventListener('submit', busy(save, async () => { const body = { title: t.value, summary: s.value, body: b.value, photo, published: pub.checked }; try { if (p.id) await api('posts/' + p.id, { method: 'PUT', body }); else await api('posts', { method: 'POST', body }); toast('Post saved'); location.hash = '#journal'; } catch (e) { err.textContent = e.message; err.hidden = false; } }));
      shell('journal', form);
      const del = document.getElementById('jdel'); if (del) del.addEventListener('click', () => confirmInline(del, 'Delete for good?', async () => { await api('posts/' + p.id, { method: 'DELETE' }); location.hash = '#journal'; }));
      return;
    }
    shell('journal', h('div', { class: 'ph' }, h('div', null, h('h1', null, 'Journal'), h('p', null, 'News, new flavours and ideas. The Journal link appears on the website once a post is published, and posts help people find you on Google.')), h('a', { class: 'btn', href: '#journal/new' }, 'Write a post')),
      d.posts.length ? h('ul', { class: 'list' }, d.posts.map(p => h('li', null, h('a', { class: 'li', href: '#journal/' + p.id }, p.photo ? h('img', { class: 'thumb', src: photoSrc(p.photo), alt: '' }) : h('span', { class: 'thumb' }, '¶'), h('div', null, h('div', { class: 't' }, p.title), h('div', { class: 's' }, when(p.created))), h('span', { class: 'pill ' + (p.published ? 'paid' : 'open') }, p.published ? 'Published' : 'Draft'))))) : h('p', { class: 'empty' }, 'No posts yet.'));
  }

  /* ---------- website text and settings ---------- */
  async function websiteView() {
    const c = JSON.parse(JSON.stringify(await loadContent()));
    const inp = (obj, key, attrs = {}) => { const i = h(attrs.multi ? 'textarea' : 'input', { value: obj[key] ?? '', ...attrs, multi: null }); i.addEventListener('input', () => { obj[key] = attrs.type === 'number' ? Number(i.value) : i.value; dirty(); }); return i; };
    const chk = (obj, key) => { const i = h('input', { type: 'checkbox', checked: !!obj[key] }); i.addEventListener('change', () => { obj[key] = i.checked; dirty(); }); return i; };
    const repeat = (arr, k1, k2, l1, l2, max) => { const wrap = h('div', { class: 'repeat' }); const draw = () => { put(wrap, ...arr.map((it, i) => h('div', { class: 'ri' }, field(l1, inp(it, k1)), field(l2, inp(it, k2, { multi: true })), h('div', { class: 'row' }, h('button', { class: 'link small', type: 'button', onclick: () => { arr.splice(i, 1); draw(); dirty(); } }, 'Remove'), i > 0 ? h('button', { class: 'link small', type: 'button', onclick: () => { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; draw(); dirty(); } }, 'Move up') : null))), arr.length < max ? h('button', { class: 'btn ghost small', type: 'button', onclick: () => { arr.push({ [k1]: '', [k2]: '' }); draw(); dirty(); } }, 'Add another') : null); }; draw(); return wrap; };
    const pic = (key, label) => field(label, photoPicker(c[key], v => { c[key] = v; dirty(); }));
    const D = c.delivery; for (const k of ['collect', 'local', 'post']) D[k].feePounds = pounds(D[k].fee);
    const delOpt = (k, t) => h('div', { class: 'ri' }, h('label', { class: 'tick' }, chk(D[k], 'on'), h('strong', null, 'Offer ' + t.toLowerCase())), h('div', { class: 'grid2' }, field('Price (£, 0 for free)', inp(D[k], 'feePounds', { inputmode: 'decimal' })), h('span')), field('Description shown at checkout', inp(D[k], 'text', { multi: true })));
    const status = h('span', { class: 'small muted' }, 'All changes saved');
    let isDirty = false; function dirty() { isDirty = true; status.textContent = 'Unsaved changes'; }
    const save = h('button', { class: 'btn', type: 'button' }, 'Save changes');
    save.addEventListener('click', busy(save, async () => { const r = await api('content', { method: 'PUT', body: { content: c } }); state.content = r.content; isDirty = false; status.textContent = 'Saved. The website is updated.'; toast('Saved'); }));
    const sec = (title, open, ...kids) => h('details', { class: 'sec', open }, h('summary', null, title), h('div', null, ...kids));
    shell('website', h('div', { class: 'ph' }, h('div', null, h('h1', null, 'Website'), h('p', null, 'Change the words, photos and options on your website. Press Save when you’re done.'))),
      h('div', { class: 'stack' },
        sec('Business and contact details', true, field('Business name', inp(c, 'name')), h('div', { class: 'grid2' }, field('Contact email', inp(c.contact, 'email', { type: 'email', autocapitalize: 'none' }), 'Shown on the site. New orders and enquiries are emailed here too.'), field('Phone', inp(c.contact, 'phone', { type: 'tel' }), 'Optional')), h('div', { class: 'grid2' }, field('Area', inp(c.contact, 'area'), 'e.g. Stoke-on-Trent and nearby'), field('Hours', inp(c.contact, 'hours'), 'Optional')), h('div', { class: 'grid3' }, field('Instagram link', inp(c.contact, 'instagram', { placeholder: 'https://' })), field('Facebook link', inp(c.contact, 'facebook', { placeholder: 'https://' })), field('TikTok link', inp(c.contact, 'tiktok', { placeholder: 'https://' })))),
        sec('Legal details (for the terms of sale)', false, h('p', { class: 'small muted' }, 'UK law requires online shops to show who they are and a postal address. These appear on the Terms and Privacy pages.'), h('div', { class: 'grid2' }, field('Trading name', inp(c.legal, 'tradingName')), field('Owner’s name', inp(c.legal, 'ownerName'), 'Optional for sole traders')), field('Business address', inp(c.legal, 'address')), h('div', { class: 'grid2' }, field('Company number', inp(c.legal, 'companyNumber'), 'Only if it’s a limited company'), field('VAT number', inp(c.legal, 'vatNumber'), 'Only if VAT registered'))),
        sec('Home page', false, field('Big headline', inp(c, 'heroTitle')), field('Line under the headline', inp(c, 'heroText')), pic('heroPhoto', 'Main photo'), field('“What I make” intro', inp(c, 'makeIntro')), h('h3', null, 'What I make'), repeat(c.makeItems, 'title', 'text', 'Title', 'Description', 8), pic('makePhoto', 'Photo beside “What I make”'), pic('orderPhoto', 'Photo beside the order form')),
        sec('How ordering works (steps)', false, repeat(c.steps, 'title', 'text', 'Step', 'Description', 6)),
        sec('Weddings page', false, field('Headline', inp(c, 'weddingsTitle')), field('Introduction', inp(c, 'weddingsText', { multi: true })), repeat(c.weddingsPoints, 'title', 'text', 'Point', 'Description', 8)),
        sec('Bespoke page', false, field('Headline', inp(c, 'bespokeTitle')), field('Introduction', inp(c, 'bespokeText', { multi: true }))),
        sec('Questions (FAQ)', false, repeat(c.faq, 'q', 'a', 'Question', 'Answer', 30)),
        sec('Allergens', false, field('Allergen statement', inp(c, 'allergenStatement', { multi: true }), 'Shown at the top of the Allergens page. Say which allergens your kitchen handles.'), h('label', { class: 'tick' }, chk(c, 'allergenConfirmed'), h('span', null, 'I have checked this statement is right for my kitchen'))),
        sec('Shop, delivery and notice', false, h('label', { class: 'tick' }, chk(c, 'shopOpen'), h('strong', null, 'The shop is open for orders')), field('Message when the shop is closed', inp(c, 'closedMessage')), field('Usual notice needed (days)', inp(c, 'noticeDays', { type: 'number', min: 1, max: 90, inputmode: 'numeric' }), 'Customers can’t choose a date sooner than this.'), delOpt('collect', 'Collection'), delOpt('local', 'Local delivery'), delOpt('post', 'UK delivery')),
        sec('Emails and privacy', false, field('Send order and enquiry alerts to', inp(c, 'alertEmail', { type: 'email', autocapitalize: 'none' }), 'Leave empty to use the contact email.'), field('Delete enquiries that didn’t lead to an order after (months)', inp(c, 'keepMessagesMonths', { type: 'number', min: 3, max: 72 }), 'Shown in the privacy notice. Orders are kept 6 years for tax records.'))
      ),
      h('div', { class: 'savebar' }, status, save));
    window.onbeforeunload = () => isDirty ? true : undefined;
  }

  /* ---------- payments ---------- */
  async function paymentsView() {
    const [s, l] = await Promise.all([api('status'), api('links')]);
    shell('payments', h('div', { class: 'ph' }, h('div', null, h('h1', null, 'Payments'), h('p', null, 'Card payments go straight to your own Stripe account. Card details never touch this website.'))),
      h('div', { class: 'cols' },
        h('section', { class: 'card stack' }, h('h2', null, 'Stripe'), s.stripe ? h('p', { class: 'okmsg' }, 'Connected in ' + (s.mode === 'live' ? 'live mode: real payments are on.' : 'test mode: use Stripe’s test cards, no real money moves.')) : h('p', { class: 'err' }, 'Not connected yet. Customers can still send order requests, and you can send them payment links once it’s connected.'),
          s.stripe && !s.webhook ? h('p', { class: 'err' }, 'Add the webhook signing secret so payments are recorded even if a customer closes the page early.') : null,
          h('h3', null, 'How it’s connected'), h('ol', { class: 'how' }, h('li', null, 'Your web designer adds your Stripe secret key to the website’s hosting settings. It is never typed into this admin or stored on the website.'), h('li', null, 'In Stripe, add a webhook for this address: ', h('code', null, s.webhookUrl), ' with the event ', h('code', null, 'checkout.session.completed'), '.'), h('li', null, 'Its signing secret is added to the hosting settings the same way.'))),
        h('section', { class: 'card stack' }, h('h2', null, 'Email alerts'), s.email ? h('p', { class: 'okmsg' }, 'On. Customers get order confirmations and you get an email for every order and enquiry.') : h('p', { class: 'err' }, 'Off. New orders and messages still appear here, but nobody is emailed.'))),
      h('section', { class: 'card stack', style: null }, h('h2', null, 'Payment links'), l.links.length ? h('ul', { class: 'tlist' }, l.links.map(x => { const c = x.status === 'open' ? h('button', { class: 'link small', type: 'button' }, 'Cancel') : null; if (c) c.addEventListener('click', () => confirmInline(c, 'Cancel link?', async () => { await api('links/' + x.id, { method: 'DELETE' }); paymentsView(); })); return h('li', null, h('span', null, h('a', { href: x.kind === 'message' ? '#messages/' + x.ref_id : '#orders/' + x.ref_id }, (x.name || x.email) + ': ' + x.description), h('br'), h('span', { class: 'small muted' }, money(x.amount) + ' · ' + full(x.created))), h('span', { class: 'row' }, h('span', { class: 'pill ' + (x.status === 'open' && x.expires < Date.now() ? 'expired' : x.status) }, x.status === 'open' && x.expires < Date.now() ? 'expired' : x.status), c)); })) : h('p', { class: 'muted' }, 'Links you send for quotes and deposits will show here.')));
    document.querySelectorAll('main > section.card').forEach(x => { x.style.marginTop = '16px'; });
  }

  /* ---------- settings ---------- */
  async function settingsView() {
    const [a, s] = await Promise.all([api('account'), api('status')]);
    const cur = h('input', { type: 'password', autocomplete: 'current-password' }), np = h('input', { type: 'password', autocomplete: 'new-password' }), np2 = h('input', { type: 'password', autocomplete: 'new-password' });
    const pbtn = h('button', { class: 'btn', type: 'submit' }, 'Change password'), perr = h('p', { class: 'err', hidden: true });
    const pform = h('form', { class: 'card stack', novalidate: true }, h('h2', null, 'Your password'), field('Current password', cur), field('New password', np, 'At least 10 characters.'), field('New password again', np2), perr, h('div', null, pbtn));
    pform.addEventListener('submit', busy(pbtn, async () => { perr.hidden = true; if (np.value !== np2.value) { perr.textContent = 'The new passwords are different.'; perr.hidden = false; return; } try { await api('account/password', { method: 'POST', body: { current: cur.value, password: np.value } }); cur.value = np.value = np2.value = ''; toast('Password changed. Other devices were logged out.'); } catch (e) { perr.textContent = e.message; perr.hidden = false; } }));
    const nu = h('input', { autocomplete: 'off', autocapitalize: 'none' }), npw = h('input', { type: 'password', autocomplete: 'new-password' }), ubtn = h('button', { class: 'btn ghost', type: 'submit' }, 'Add login'), uerr = h('p', { class: 'err', hidden: true });
    const uform = h('form', { class: 'card stack', novalidate: true }, h('h2', null, 'Logins'), h('ul', { class: 'tlist' }, a.admins.map(x => { const rm = x.username === a.me ? h('span', { class: 'small muted' }, 'You') : h('button', { class: 'link small', type: 'button' }, 'Remove'); if (rm.tagName === 'BUTTON') rm.addEventListener('click', () => confirmInline(rm, 'Remove?', async () => { await api('account/users?u=' + encodeURIComponent(x.username), { method: 'DELETE' }); settingsView(); })); return h('li', null, h('span', null, x.username), rm); })), h('p', { class: 'small muted' }, 'Give each person their own login. Never share passwords.'), h('div', { class: 'grid2' }, field('Username', nu), field('Password', npw)), uerr, h('div', null, ubtn));
    uform.addEventListener('submit', busy(ubtn, async () => { uerr.hidden = true; try { await api('account/users', { method: 'POST', body: { username: nu.value, password: npw.value } }); toast('Login added'); settingsView(); } catch (e) { uerr.textContent = e.message; uerr.hidden = false; } }));
    const em = h('input', { type: 'email', class: 'inp', placeholder: 'customer@example.com', autocapitalize: 'none' }), ebtn = h('button', { class: 'btn ghost', type: 'button' }, 'Download their data');
    ebtn.addEventListener('click', busy(ebtn, async () => { const d = await api('export?email=' + encodeURIComponent(em.value)); const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }); const u = URL.createObjectURL(blob); const link = h('a', { href: u, download: 'data-' + d.email + '.json' }); document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(u), 5000); toast((d.messages.length + d.orders.length) + ' records found'); }));
    const out = h('button', { class: 'btn ghost', type: 'button' }, 'Log out');
    out.addEventListener('click', async () => { await api('logout', { method: 'POST' }).catch(() => {}); state.user = null; state.content = null; location.hash = ''; renderLogin(); });
    const outAll = h('button', { class: 'btn danger', type: 'button' }, 'Log out every device');
    outAll.addEventListener('click', () => confirmInline(outAll, 'Log out everywhere?', async () => { await api('account/logout-all', { method: 'POST' }); state.user = null; renderLogin('Logged out everywhere. Log in again.'); }));
    shell('settings', h('div', { class: 'ph' }, h('div', null, h('h1', null, 'Settings'), h('p', null, 'Logged in as ' + a.me + '.')), h('div', { class: 'row' }, out, outAll)),
      h('div', { class: 'cols' }, pform, uform,
        h('section', { class: 'card stack' }, h('h2', null, 'Before you go live'), h('ul', { class: 'checklist' }, s.checklist.map(c => h('li', null, h('span', { class: 'dot' + (c.done ? ' on' : '') }), h('span', null, c.text))))),
        h('section', { class: 'card stack' }, h('h2', null, 'Customer data requests'), h('p', { class: 'small muted' }, 'If a customer asks for a copy of their data (a subject access request), download everything held for their email here. You have one month to reply. To delete their data, delete their messages; paid orders must be kept 6 years for tax.'), em, h('div', null, ebtn)),
        h('section', { class: 'card stack' }, h('h2', null, 'Recent activity'), h('ul', { class: 'tlist' }, a.log.slice(0, 25).map(l => h('li', null, h('span', null, l.who + ': ' + l.action), h('span', { class: 'small muted' }, when(l.at) + (l.place ? ' · ' + l.place : ''))))))));
  }

  boot();
})();
