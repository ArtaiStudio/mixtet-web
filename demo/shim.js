/* Mixtet demo – shim pro skutečné stránky member.html a fullmix.html v iframu.
   Je to PRVNÍ skript stránky: přesměruje fetch('/api/…') a EventSource na simulovaný hub v rodičovské stránce
   (window.parent.MixtetHubSim). Stránka sama zůstává beze změny – mluví se stejnými adresami jako s Macem. */
(function () {
  'use strict';
  var hub = null;
  try { if (window.parent && window.parent !== window) hub = window.parent.MixtetHubSim || null; } catch (e) { hub = null; }
  if (!hub) {
    // stránka otevřená mimo ukázku – zpátky na ukázku
    try { location.replace('./'); } catch (e) {}
    return;
  }
  var role = /fullmix/.test(location.pathname) ? 'fullmix' : 'member';
  var nativeReplace = history.replaceState.bind(history);
  var home = location.pathname + location.search + location.hash;

  // MARK: - klíč: stránka člena čte /m/<klíč>, iPad /c/<odkaz> + uloženou session (jako po spárování)
  var key = role === 'member' ? hub.memberKey() : hub.tabletLink();
  try {
    if (role === 'fullmix') localStorage.setItem('krai.fullmix.' + key, hub.tabletSession());
    localStorage.setItem('krai-hint-wake', '1');
  } catch (e) { /* bez úložiště: iPad ukáže PIN – v ukázce projde jakýchkoli 6 číslic */ }
  nativeReplace(history.state, '', (role === 'member' ? '/m/' : '/c/') + key + location.search);
  // po spuštění skriptů stránky vrátit skutečnou adresu (reload iframu pak najde member.html / fullmix.html)
  document.addEventListener('DOMContentLoaded', function () { nativeReplace(history.state, '', home); });
  // stránka si chce adresu přepsat na /m/<klíč> (zástupce na ploše) – v ukázce ne
  history.replaceState = function (s, t, u) {
    if (u != null && /^\/(m|c)\//.test(String(u))) return;
    return nativeReplace(s, t, u);
  };

  // MARK: - fetch
  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    var raw = typeof input === 'string' ? input : (input && input.url) || String(input);
    var url;
    try { url = new URL(raw, location.href); } catch (e) { return nativeFetch(input, init); }
    if (url.origin !== location.origin || url.pathname.indexOf('/api/') !== 0) return nativeFetch(input, init);
    var method = ((init && init.method) || 'GET').toUpperCase();
    var body = init && init.body != null ? String(init.body) : '';
    return new Promise(function (resolve) {
      hub.request(method, url.pathname, body, function (r) {
        resolve(new Response(JSON.stringify(r.json), {status: r.status, headers: {'Content-Type': 'application/json; charset=utf-8'}}));
      });
    });
  };

  // MARK: - EventSource
  var streams = [];
  function FakeEventSource(url) {
    this.url = String(url);
    this.withCredentials = false;
    this.readyState = 0;
    this.onopen = null; this.onmessage = null; this.onerror = null;
    this._l = {};
    var self = this, path;
    try { path = new URL(this.url, location.href).pathname; } catch (e) { path = this.url; }
    this._conn = hub.openStream(path, function (type, data) {
      // doručit v kontextu stránky (chyby se ukážou v konzoli iframu, pořadí zůstává)
      window.setTimeout(function () { self._dispatch(type, data); }, 0);
    });
    streams.push(this);
    window.setTimeout(function () {
      if (self.readyState === 2) return;
      if (self._conn) { self.readyState = 1; self._dispatch('open'); }
      else { self.readyState = 2; self._dispatch('error'); }
    }, 0);
  }
  FakeEventSource.CONNECTING = 0; FakeEventSource.OPEN = 1; FakeEventSource.CLOSED = 2;
  FakeEventSource.prototype.CONNECTING = 0; FakeEventSource.prototype.OPEN = 1; FakeEventSource.prototype.CLOSED = 2;
  FakeEventSource.prototype.addEventListener = function (type, fn) { if (fn) (this._l[type] = this._l[type] || []).push(fn); };
  FakeEventSource.prototype.removeEventListener = function (type, fn) {
    var l = this._l[type]; if (!l) return; var i = l.indexOf(fn); if (i >= 0) l.splice(i, 1);
  };
  FakeEventSource.prototype.close = function () {
    if (this.readyState === 2) return;
    this.readyState = 2;
    if (this._conn) this._conn.close();
    var i = streams.indexOf(this); if (i >= 0) streams.splice(i, 1);
  };
  FakeEventSource.prototype._dispatch = function (type, data) {
    if (this.readyState === 2 && type !== 'error') return;
    var ev = type === 'open' || type === 'error' ? new Event(type) : new MessageEvent(type, {data: data});
    var handler = type === 'message' ? this.onmessage : type === 'open' ? this.onopen : type === 'error' ? this.onerror : null;
    if (handler) handler.call(this, ev);
    (this._l[type] || []).slice().forEach(function (fn) { fn.call(this, ev); }, this);
  };
  window.EventSource = FakeEventSource;
  window.addEventListener('pagehide', function () { streams.slice().forEach(function (s) { s.close(); }); });

  // MARK: - displej: v ukázce ho nedržíme (žádné tiché video ani Wake Lock) – stránka jen ukáže, že svítí
  try {
    var sentinel = {released: false, addEventListener: function () {}, removeEventListener: function () {}, release: function () { return Promise.resolve(); }};
    Object.defineProperty(navigator, 'wakeLock', {configurable: true, value: {request: function () { return Promise.resolve(sentinel); }}});
  } catch (e) {}

  // MARK: - který iframe se naposledy používal (kontext ke zpětné vazbě)
  window.addEventListener('pointerdown', function () { try { hub.noteUse(role); } catch (e) {} }, true);
  window.addEventListener('keydown', function () { try { hub.noteUse(role); } catch (e) {} }, true);
})();
