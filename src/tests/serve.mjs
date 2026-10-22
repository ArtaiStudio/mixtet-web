// Místní server pro testy webu: spustí skutečný dist/_worker.js s náhradou D1 (node:sqlite v paměti)
// a ASSETS (soubory z dist/ + pravidla z dist/_headers jako na Cloudflare Pages). Nic se neposílá ven.
// Spuštění: node src/tests/serve.mjs [port] [dist]   (heslo /admin = "test")
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const port = Number(process.argv[2] || 8788);
const dist = path.resolve(process.argv[3] || 'dist');
const worker = (await import(pathToFileURL(path.join(dist, '_worker.js')).href)).default;

// MARK: - D1 nad node:sqlite (prepare/bind/run/all/first, batch)
const sqlite = new DatabaseSync(':memory:');
const D1 = {
  prepare(sql) {
    const make = (args) => ({
      bind: (...a) => make(a),
      run: async () => { sqlite.prepare(sql).run(...args); return { success: true }; },
      all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
      first: async () => sqlite.prepare(sql).get(...args) ?? null,
    });
    return make([]);
  },
  async batch(stmts) { for (const s of stmts) await s.run(); return []; },
};

// MARK: - _headers (cesty s *, „! Hlavička“ = odebrat)
function parseHeaders(text) {
  const rules = []; let cur = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { cur = { pattern: line.trim(), set: [], detach: [] }; rules.push(cur); continue; }
    const l = line.trim();
    if (l.startsWith('!')) cur.detach.push(l.slice(1).trim().toLowerCase());
    else { const i = l.indexOf(':'); cur.set.push([l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim()]); }
  }
  return rules;
}
const rules = parseHeaders(fs.readFileSync(path.join(dist, '_headers'), 'utf8'));
const matches = (pattern, p) => new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(p);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4', '.txt': 'text/plain', '.xml': 'application/xml' };

const ASSETS = {
  async fetch(req) {
    const u = new URL(req.url);
    let p = decodeURIComponent(u.pathname);
    let file = path.join(dist, p);
    if (!file.startsWith(dist)) return new Response('Forbidden', { status: 403 });
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
    if (!fs.existsSync(file) || path.basename(file).startsWith('_')) return new Response('Not found', { status: 404 });
    const h = new Headers({ 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    for (const r of rules) {
      if (!matches(r.pattern, u.pathname)) continue;
      for (const d of r.detach) h.delete(d);
      for (const [k, v] of r.set) h.has(k) ? h.set(k, h.get(k) + ', ' + v) : h.set(k, v);
    }
    return new Response(fs.readFileSync(file), { headers: h });
  },
};
const env = { DB: D1, ASSETS, ADMIN_KEY: 'test' };

http.createServer(async (nreq, nres) => {
  try {
    const chunks = []; for await (const c of nreq) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = new Headers();
    for (const [k, v] of Object.entries(nreq.headers)) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    const req = new Request(`http://${nreq.headers.host}${nreq.url}`, { method: nreq.method, headers,
      body: ['GET', 'HEAD'].includes(nreq.method) ? undefined : body, redirect: 'manual' });
    const res = await worker.fetch(req, env);
    const out = {}; res.headers.forEach((v, k) => { out[k] = v; });
    nres.writeHead(res.status, out);
    nres.end(Buffer.from(await res.arrayBuffer()));
  } catch (e) {
    console.error(e); nres.writeHead(500); nres.end('server error');
  }
}).listen(port, '127.0.0.1', () => console.log(`mixtet test server http://127.0.0.1:${port} (dist ${dist})`));
