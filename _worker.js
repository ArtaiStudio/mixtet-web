// Mixtet web – Cloudflare Pages (advanced mode). Statické soubory jdou přes env.ASSETS,
// formuláře přes /api/*. Odpovědi se ukládají do D1 (binding DB). Přehled pro kapelníka: /admin
// (HTTP Basic, heslo = proměnná ADMIN_KEY nastavená v Cloudflare – bez ní /admin neexistuje).

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS signups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL, updated_at TEXT,
    lang TEXT, email TEXT NOT NULL UNIQUE, band TEXT, mixer TEXT, hub TEXT,
    members TEXT, iem TEXT, country TEXT, note TEXT, source TEXT,
    consent INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'nová')`,
  `CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL, email TEXT, kind TEXT, severity TEXT, message TEXT NOT NULL,
    app_version TEXT, os TEXT, mixer TEXT, lang TEXT, source TEXT)`,
  // Zájem o ukázku /demo/: jen počty za den, žádná IP, žádné ID, žádné cookies.
  `CREATE TABLE IF NOT EXISTS demo_stats (
    day TEXT NOT NULL, type TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, type))`,
];
let ready = false;
async function ensureSchema(db) {
  if (ready) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  ready = true;
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const pick = (v, allowed, dflt = '') => (allowed.includes(v) ? v : dflt);
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function readBody(req) {
  const type = req.headers.get('content-type') || '';
  if (type.includes('application/json')) return await req.json();
  const f = await req.formData();
  const o = {};
  for (const [k, v] of f.entries()) o[k] = o[k] ? [].concat(o[k], v) : v;
  return o;
}

// Ochrana proti robotům bez sledování: skryté pole „web“ musí zůstat prázdné a formulář
// nesmí být odeslaný dřív než 3 s po načtení stránky (t = čas načtení v ms).
function looksLikeBot(b) {
  if (clip(b.web, 200)) return true;
  const t = Number(b.t);
  return !Number.isFinite(t) || Date.now() - t < 3000;
}

async function signup(req, env) {
  if (!env.DB) return json({ ok: false, error: 'storage' }, 503);
  let b;
  try { b = await readBody(req); } catch { return json({ ok: false, error: 'body' }, 400); }
  if (looksLikeBot(b)) return json({ ok: true }); // robotovi nic neprozradíme
  const email = clip(b.email, 254).toLowerCase();
  if (!EMAIL.test(email)) return json({ ok: false, error: 'email' }, 422);
  if (!(b.consent === true || b.consent === 'on' || b.consent === '1')) return json({ ok: false, error: 'consent' }, 422);
  const hubs = [].concat(b.hub || []).map(String).filter((h) => ['mac', 'ipad', 'windows', 'android', 'unsure'].includes(h));
  const row = {
    lang: pick(b.lang, ['cs', 'en'], 'en'),
    email,
    band: clip(b.band, 80),
    mixer: pick(b.mixer, ['xr18', 'xr16', 'xr12', 'mr18', 'x32', 'other'], ''),
    hub: hubs.join(','),
    members: pick(String(b.members || ''), ['2', '3', '4', '5', '6', '7+'], ''),
    iem: pick(b.iem, ['yes', 'planning', 'no'], ''),
    country: clip(b.country, 60),
    note: clip(b.note, 1000),
    source: clip(b.source, 60) || 'direct',
  };
  if (!row.mixer) return json({ ok: false, error: 'mixer' }, 422);
  const now = new Date().toISOString();
  await ensureSchema(env.DB);
  // Stejný e-mail podruhý = aktualizace (žádné duplicity, žádná chyba pro uživatele).
  await env.DB.prepare(
    `INSERT INTO signups (created_at, lang, email, band, mixer, hub, members, iem, country, note, source, consent)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1)
     ON CONFLICT(email) DO UPDATE SET updated_at = ?1, lang = ?2, band = ?4, mixer = ?5, hub = ?6,
       members = ?7, iem = ?8, country = ?9, note = ?10`
  ).bind(now, row.lang, row.email, row.band, row.mixer, row.hub, row.members, row.iem, row.country, row.note, row.source).run();
  return json({ ok: true });
}

async function feedback(req, env) {
  if (!env.DB) return json({ ok: false, error: 'storage' }, 503);
  let b;
  try { b = await readBody(req); } catch { return json({ ok: false, error: 'body' }, 400); }
  if (looksLikeBot(b)) return json({ ok: true });
  const message = clip(b.message, 4000);
  if (message.length < 3) return json({ ok: false, error: 'message' }, 422);
  const email = clip(b.email, 254).toLowerCase();
  if (email && !EMAIL.test(email)) return json({ ok: false, error: 'email' }, 422);
  await ensureSchema(env.DB);
  await env.DB.prepare(
    `INSERT INTO feedback (created_at, email, kind, severity, message, app_version, os, mixer, lang, source)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
  ).bind(
    new Date().toISOString(), email,
    pick(b.kind, ['bug', 'idea', 'other'], 'other'),
    pick(b.severity, ['blocker', 'slows', 'minor'], ''),
    message, clip(b.v, 40), clip(b.os, 60), clip(b.mixer, 60),
    pick(b.lang, ['cs', 'en'], 'en'), clip(b.source, 60) || 'web'
  ).run();
  return json({ ok: true });
}

// MARK: - Počítadlo zájmu o ukázku (/api/demo-event) – bez cookies, bez IP, bez ID: jen +1 za den a typ
const DEMO_EVENTS = ['start', 'tour_done', 'midi_connected', 'signup_click'];

async function demoEvent(req, env, url) {
  if (!env.DB) return json({ ok: false, error: 'storage' }, 503);
  // jen z vlastní stránky (prohlížeč posílá Origin u POST); cizí weby nepočítáme
  const origin = req.headers.get('origin');
  if (origin && origin !== url.origin) return json({ ok: false }, 403);
  let b;
  try { b = await readBody(req); } catch { return json({ ok: false, error: 'body' }, 400); }
  const type = pick(b && b.type, DEMO_EVENTS, '');
  if (!type) return json({ ok: false, error: 'type' }, 422);
  await ensureSchema(env.DB);
  await env.DB.prepare(
    `INSERT INTO demo_stats (day, type, n) VALUES (?1, ?2, 1)
     ON CONFLICT(day, type) DO UPDATE SET n = n + 1`
  ).bind(new Date().toISOString().slice(0, 10), type).run();
  return json({ ok: true });
}

// MARK: - Přehled pro kapelníka (/admin)

function timingSafeEqual(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] || 0) ^ (y[i] || 0);
  return d === 0;
}

function authorized(req, env) {
  const h = req.headers.get('authorization') || '';
  if (!h.startsWith('Basic ')) return false;
  let pass = '';
  try { pass = atob(h.slice(6)).split(':').slice(1).join(':'); } catch { return false; }
  return timingSafeEqual(pass, env.ADMIN_KEY);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function csv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s; // ochrana proti vzorcům v Excelu
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
}

async function admin(req, env, url) {
  if (!env.ADMIN_KEY) return new Response('Not found', { status: 404 });
  if (!authorized(req, env)) {
    return new Response('Přihlášení', { status: 401, headers: { 'www-authenticate': 'Basic realm="Mixtet admin", charset="UTF-8"' } });
  }
  if (!env.DB) return new Response('Chybí databáze (binding DB).', { status: 503 });
  await ensureSchema(env.DB);
  const s = (await env.DB.prepare('SELECT * FROM signups ORDER BY created_at DESC').all()).results;
  const f = (await env.DB.prepare('SELECT * FROM feedback ORDER BY created_at DESC').all()).results;
  const ds = (await env.DB.prepare('SELECT day, type, n FROM demo_stats ORDER BY day DESC').all()).results;
  // ukázka: řádek = den, sloupce = typy událostí
  const demoDays = [];
  for (const r of ds) {
    let row = demoDays.find((x) => x.day === r.day);
    if (!row) { row = { day: r.day }; for (const t of DEMO_EVENTS) row[t] = 0; demoDays.push(row); }
    row[r.type] = r.n;
  }
  const demoTotal = ds.reduce((m, r) => ((m[r.type] = (m[r.type] || 0) + r.n), m), {});
  if (url.pathname === '/admin/signups.csv' || url.pathname === '/admin/feedback.csv') {
    const name = url.pathname.split('/').pop();
    return new Response(csv(name.startsWith('signups') ? s : f), {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="mixtet-${name}"`, 'cache-control': 'no-store' },
    });
  }
  const count = (k) => s.reduce((m, r) => ((m[r[k] || '–'] = (m[r[k] || '–'] || 0) + 1), m), {});
  const hubCount = s.reduce((m, r) => { for (const h of (r.hub || '–').split(',')) m[h] = (m[h] || 0) + 1; return m; }, {});
  const chips = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span>${esc(k)} <b>${v}</b></span>`).join('');
  const table = (rows, cols) => rows.length
    ? `<table><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c])}</td>`).join('')}</tr>`).join('')}</table>`
    : '<p>Zatím nic.</p>';
  const html = `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Mixtet – přihlášky</title><style>
body{margin:0;background:#0C1014;color:#F1EFE7;font:15px/1.5 system-ui,-apple-system,sans-serif}main{padding:24px 16px;max-width:1400px;margin:0 auto}
h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:28px 0 8px}a{color:#CDA977}.k{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0}
.k span{background:#1D252E;border:1px solid #2A333D;border-radius:8px;padding:4px 10px;color:#BDB09C}.k b{color:#F1EFE7;font-variant-numeric:tabular-nums}
.t{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #2A333D;vertical-align:top}th{color:#958B7C;font-weight:600;white-space:nowrap}
</style></head><body><main><h1>Mixtet – přihlášky a zpětná vazba</h1>
<p>Přihlášky: ${s.length} · Zpětná vazba: ${f.length} · <a href="/admin/signups.csv">přihlášky CSV</a> · <a href="/admin/feedback.csv">zpětná vazba CSV</a></p>
<h2>Odkud</h2><div class="k">${chips(count('source'))}</div><h2>Pult</h2><div class="k">${chips(count('mixer'))}</div>
<h2>Na čem by běžel hub</h2><div class="k">${chips(hubCount)}</div><h2>Jazyk</h2><div class="k">${chips(count('lang'))}</div>
<h2>Přihlášky</h2><div class="t">${table(s, ['created_at', 'email', 'band', 'mixer', 'hub', 'members', 'iem', 'country', 'lang', 'source', 'note', 'status'])}</div>
<h2>Zpětná vazba</h2><div class="t">${table(f, ['created_at', 'kind', 'severity', 'message', 'email', 'app_version', 'os', 'mixer', 'source'])}</div>
<h2>Ukázka /demo/ (počty za den, bez sledování)</h2><div class="k">${chips(demoTotal)}</div><div class="t">${table(demoDays, ['day', ...DEMO_EVENTS])}</div>
</main></body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      if (url.pathname === '/api/signup') return req.method === 'POST' ? await signup(req, env) : json({ ok: false }, 405);
      if (url.pathname === '/api/feedback') return req.method === 'POST' ? await feedback(req, env) : json({ ok: false }, 405);
      if (url.pathname === '/api/demo-event') return req.method === 'POST' ? await demoEvent(req, env, url) : json({ ok: false }, 405);
      if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return await admin(req, env, url);
    } catch (e) {
      console.error('mixtet api', e && e.stack || e);
      return json({ ok: false, error: 'server' }, 500);
    }
    // Ukázka /demo/: skutečné stránky Mixtetu běží v iframech ze stejného webu – jen tady povolit rámy
    // ze stejného původu (jinde zůstává X-Frame-Options: DENY a frame-ancestors 'none' z _headers).
    const demo = url.pathname.startsWith('/demo/');
    if (url.pathname === '/demo') return Response.redirect(new URL('/demo/' + url.search, url).toString(), 301);
    if (req.method === 'GET' && ['/', '/cs/', '/demo/', '/demo/cs/'].includes(url.pathname)) {
      const to = langRedirect(req, url);
      if (to) return Response.redirect(to, 302);
      const res = await env.ASSETS.fetch(req);
      const out = new Response(res.body, res);
      out.headers.set('vary', 'Accept-Language, Cookie');
      if (demo) demoHeaders(out.headers);
      return out;
    }
    if (demo) {
      const res = await env.ASSETS.fetch(req);
      const out = new Response(res.body, res);
      demoHeaders(out.headers);
      return out;
    }
    return env.ASSETS.fetch(req);
  },
};

function demoHeaders(h) {
  h.set('x-frame-options', 'SAMEORIGIN');
  h.set('content-security-policy', DEMO_CSP);
  h.set('x-robots-tag', 'noindex, nofollow');   // ukázka zatím mimo vyhledávače (dokud ji Martin neschválí)
}
const DEMO_CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; " +
  "connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'";

// MARK: - Jazyk (best practice): 1) ?lang= v odkazu, 2) ruční volba (cookie), 3) jazyk prohlížeče
// (cs i sk → čeština), 4) angličtina. Žádné IP. Každý jazyk má vlastní adresu: / (EN) a /cs/ (CZ).
// Stejně pro ukázku: /demo/ (EN) a /demo/cs/ (CZ).
function langRedirect(req, url) {
  const q = url.searchParams.get('lang');
  const en = url.pathname.startsWith('/demo/') ? '/demo/' : '/';
  const cs = en + 'cs/';
  const target = (lang) => {
    const u = new URL(url);
    u.pathname = lang === 'cs' ? cs : en;
    u.searchParams.delete('lang');
    return u.pathname === url.pathname && !q ? null : u.toString();
  };
  if (q === 'cs' || q === 'en') return target(q);
  if (url.pathname === cs) return null; // na /cs/ nikdy automaticky nepřesměrovávat zpět
  const cookie = (req.headers.get('cookie') || '').match(/(?:^|;\s*)mixtet-lang=(cs|en)/);
  if (cookie) return cookie[1] === 'cs' ? target('cs') : null;
  const al = (req.headers.get('accept-language') || '').toLowerCase();
  const prefs = al.split(',').map((p) => {
    const [tag, qv] = p.trim().split(';q=');
    return { base: tag.split('-')[0], q: qv ? Number(qv) : 1 };
  }).filter((p) => p.base && p.base !== '*').sort((a, b) => b.q - a.q);
  for (const p of prefs) {
    if (p.base === 'cs' || p.base === 'sk') return target('cs');
    if (p.base === 'en') return null;
  }
  return null;
}
