/* Mixtet demo – iPad jako samostatný hub (ADR-022: bez Macu je hubem iPad). Stejné stránky jako Mac appka:
   Mixer (+ Režim Koncert), Kanál (Jednoduše / Celý řetězec), Odposlechy, Scény a setlist, Kapela, Nastavení.
   Mluví přímo se simulovaným pultem v rodičovské stránce (window.parent.MixtetHubSim) s původem „hub“.
   Zákony appky: zápis jen přes hub (pult je zdroj pravdy), do echa číslo kurzívou s „…“, bez potvrzení do 1 s
   zpět + hláška, bez spojení se nic neodešle, červená jen přímý MUTE, oranžová mute skupina / DCA, ivory MLUVIT,
   barva kanálu = barva vlastníka s iniciálou, cíle ≥ 44 px. Texty CZ / EN v texts.js. */
(function () {
  'use strict';
  let hub = null;
  try { if (window.parent && window.parent !== window) hub = window.parent.MixtetHubSim || null; } catch (e) { hub = null; }
  if (!hub) { try { location.replace('/demo/'); } catch (e) {} return; }
  const MH = window.parent.MixtetHub, X = hub.X;
  const LANG = new URLSearchParams(location.search).get('lang') === 'cs' ? 'cs' : 'en';
  document.documentElement.lang = LANG;
  const TT = (window.IPAD_T || {})[LANG] || {};
  const t = (k, ...a) => { const v = TT[k]; if (v == null) { console.warn('ipad: missing text', k); return k; } return typeof v === 'function' ? v(...a) : v; };
  const $ = id => document.getElementById(id);
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function btn(cls, text, on) { const b = el('button', 'btn ' + (cls || ''), text); b.type = 'button'; if (on) b.addEventListener('click', on); return b; }
  const store = {
    get(k, d) { try { const v = localStorage.getItem('mixtet-ipad.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('mixtet-ipad.' + k, JSON.stringify(v)); } catch (e) {} }
  };
  const lin = MH.lin, dbf = MH.dbf;
  const dbt = d => { if (!isFinite(d) || d < -89.5) return '−∞'; const r = Math.round(d * 10) / 10 || 0; return (r < 0 ? '−' : '+') + Math.abs(r).toFixed(1); };
  const sgn = (v, digits) => { const r = +v.toFixed(digits); return (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r).toFixed(digits); };
  const hz = f => f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 0 : 1).replace('.0', '') + ' kHz' : Math.round(f) + ' Hz';
  const pad = n => String(n).padStart(2, '0');
  const MEMBERS = [1, 2, 3, 4];
  const mcol = b => 'var(--krai-member-' + b + ')';
  const mname = b => hub.memberName(b);
  const TICKS = [['+10', 1], ['+5', .875], ['0', .75], ['−5', .625], ['−10', .5], ['−20', .375], ['−30', .25], ['−50', .125], ['−∞', 0]];

  // MARK: - stav stránky (per-viewer pohodlí v localStorage, nic, na čem by záleželo)
  const SL = hub.strips();
  const byId = Object.fromEntries(SL.map(s => [s.id, s]));
  const CH = SL.filter(s => s.kind === 'ch');
  const ST = {
    page: 'mixer', concert: store.get('concert', false), sel: hub.selected() || '/ch/01', mon: store.get('mon', 1),
    chView: store.get('chView', 'simple'), eqBand: 2, scope: {mix: true, groups: true}, smooth: false,
    talkTo: hub.talkTargets(), toggleTalk: store.get('toggleTalk', false), keys: store.get('keys', true), bank: hub.bank()
  };
  if (!byId[ST.sel] || byId[ST.sel].kind !== 'ch') ST.sel = '/ch/01';

  // MARK: - hlášky (status oblast + toast „co se stalo – co s tím“)
  let tt = 0;
  function say(msg) { const l = $('live'); l.textContent = ''; setTimeout(() => { l.textContent = msg; }, 30); }
  function toast(msg, err, actText, act) {
    const e = $('toast'), b = $('toastB');
    $('toastT').textContent = msg; e.classList.toggle('err', !!err); e.classList.add('on');
    b.hidden = !actText; b.textContent = actText || ''; b.onclick = () => { e.classList.remove('on'); if (act) act(); };
    say(msg + (actText ? ' ' + t('toastBtn', actText) : ''));
    clearTimeout(tt); tt = setTimeout(() => e.classList.remove('on'), Math.max(err ? 5000 : 2800, msg.length * 65) + (actText ? 3000 : 0));
  }
  const online = () => hub.connected();
  const offline = () => toast(t('offline'), true);

  // MARK: - zápis do pultu + krok Zpět (jedna akce = jeden krok)
  const undo = [];
  let grp = null;
  const P = {};             // vlastní zápisy čekající na echo: adresa → {t, v, ok}
  const dragging = new Set();
  function begin(label) { grp = {label, b: {}}; }
  function end() { if (grp && Object.keys(grp.b).length) { undo.push(grp); if (undo.length > 60) undo.shift(); } grp = null; sched(); }
  function act(label, fn) { begin(label); let r; try { r = fn(); } finally { end(); } return r; }
  function w(a, v) {
    if (!online()) { offline(); return false; }
    if (grp && !(a in grp.b)) grp.b[a] = hub.known(a);
    P[a] = {t: Date.now(), v: MH.pultValue(a, v), ok: false};
    hub.write(a, v, 'hub'); sched();
    return true;
  }
  function doUndo() {
    const g = undo.pop(); if (!g) return;
    if (!online()) { undo.push(g); offline(); return; }
    for (const a in g.b) if (g.b[a] !== undefined) { P[a] = {t: Date.now(), v: g.b[a], ok: false}; hub.write(a, g.b[a], 'hub'); }
    toast(t('undone', g.label)); sched();
  }
  function lastUndo() { return undo.length ? undo[undo.length - 1].label : ''; }
  const onChange = c => { if (P[c.a] && c.origin === 'hub') P[c.a].ok = true; sched(); };
  // bez potvrzení pultu do 1 s → zpět na poslední potvrzenou hodnotu + hláška (pult hodnotu nemá – nic neplatí)
  setInterval(() => {
    let rev = 0; const now = Date.now();
    for (const a in P) {
      if (hub.isPending(a) && now - P[a].t < 1000) continue;
      if (dragging.has(a) && hub.isPending(a)) continue;
      if (!P[a].ok && !hub.isPending(a)) rev++;
      delete P[a];
    }
    if (rev) toast(t('reverted'), true);
  }, 250);

  // MARK: - překreslení: hodnoty se mění, struktura zůstává (zákon v10 č. 4)
  let W = [];
  const WG = [];
  let queued = false;
  function sched() { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; paint(); }); }
  function paint() { for (const f of WG) f(); for (const f of W) f(); }
  const known = a => hub.known(a) !== undefined;
  const pend = a => hub.isPending(a);
  const val = a => hub.get(a);

  // MARK: - modely ovládacích prvků
  /** Fader v dB (zákon faderu XR18): šipky ±1 dB, Home = 0 dB, End = −∞. */
  function faderModel(a, label) {
    return {a, label, get: () => val(a), known: () => known(a), pend: () => pend(a), set: v => w(a, MH.quant(v)),
      text: () => known(a) ? dbt(lin(val(a))) : '—', step: dir => { const d = lin(val(a)) + dir; return d <= -90 ? 0 : dbf(Math.max(-90, d)); },
      home: () => dbf(0), endv: () => 0, keys: [a]};
  }
  /** Parametr pultu 0–1 s krokem pultu a vlastním formátem. */
  function paramModel(a, label, steps, fmt) {
    return {a, label, get: () => val(a), known: () => known(a), pend: () => pend(a), set: v => w(a, v),
      text: () => known(a) ? fmt(val(a)) : '—', step: dir => Math.min(1, Math.max(0, val(a) + dir / (steps - 1))), keys: [a]};
  }
  /** Makro 0–10 nad několika skutečnými parametry (Čistota, Vyrovnání). */
  function macroModel(label, get, set, keys, fmt) {
    return {label, get: () => get() / 10, known: () => keys.every(known), pend: () => keys.some(pend),
      set: v => { const n = Math.round(Math.min(1, Math.max(0, v)) * 10); if (n !== get()) set(n); }, text: () => keys.every(known) ? fmt(get()) : '—',
      step: dir => Math.min(1, Math.max(0, (get() + dir) / 10)), keys};
  }

  // MARK: - prvky
  const posV = v => `calc(var(--capH) / 2 + (100% - var(--capH)) * ${(1 - v).toFixed(4)})`;
  function bindDrag(node, m, horizontal, getLen, label) {
    let start = 0, startV = 0, len = 1, id = null;
    node.addEventListener('pointerdown', e => {
      if (!m.known()) return;
      if (!online()) { offline(); return; }
      e.preventDefault();
      node.setPointerCapture(e.pointerId); id = e.pointerId;
      m.keys.forEach(k => dragging.add(k));
      begin(label || m.label);
      len = Math.max(1, getLen()); start = horizontal ? e.clientX : e.clientY; startV = m.get();
    });
    node.addEventListener('pointermove', e => {
      if (id !== e.pointerId) return;
      const d = horizontal ? e.clientX - start : start - e.clientY;
      const nv = Math.min(1, Math.max(0, startV + d / len));
      if (Math.abs(nv - m.get()) > 1e-4) m.set(nv);
    });
    const stop = e => { if (id !== e.pointerId) return; id = null; m.keys.forEach(k => dragging.delete(k)); end(); };
    node.addEventListener('pointerup', stop); node.addEventListener('pointercancel', stop);
    node.addEventListener('keydown', e => {
      if (!m.known()) return;
      let nv = null;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') nv = m.step(1);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') nv = m.step(-1);
      else if (e.key === 'PageUp') nv = m.step(6); else if (e.key === 'PageDown') nv = m.step(-6);
      else if (e.key === 'Home' && m.home) nv = m.home(); else if (e.key === 'End' && m.endv) nv = m.endv();
      if (nv == null) return;
      e.preventDefault(); act(label || m.label, () => m.set(nv));
    });
  }
  function vFader(m, color) {
    const f = el('div', 'fader'); if (color) f.style.setProperty('--cc', color);
    f.setAttribute('role', 'slider'); f.setAttribute('aria-label', m.label); f.setAttribute('aria-orientation', 'vertical'); f.tabIndex = 0;
    f.innerHTML = '<div class="track"></div>' + TICKS.map(() => '<div class="tk"></div>').join('') + '<div class="cap"></div>';
    const cap = f.lastChild;
    f.querySelectorAll('.tk').forEach((x, i) => { x.style.top = posV(TICKS[i][1]); });
    bindDrag(f, m, false, () => f.clientHeight - cap.offsetHeight);
    W.push(() => { f.classList.toggle('unknown', !m.known()); if (m.known()) cap.style.top = posV(m.get());
      f.setAttribute('aria-valuetext', m.text() + (m.text() === '—' ? '' : ' dB')); });
    return f;
  }
  function hSlider(m, color) {
    const f = el('div', 'hs'); if (color) f.style.setProperty('--hc', color);
    f.setAttribute('role', 'slider'); f.setAttribute('aria-label', m.label); f.tabIndex = 0;
    f.innerHTML = '<div class="rail"></div><div class="fill"></div><div class="knob"></div>';
    const fill = f.children[1], knob = f.children[2];
    bindDrag(f, m, true, () => f.clientWidth - knob.offsetWidth);
    W.push(() => { f.classList.toggle('unknown', !m.known());
      if (m.known()) { const x = `calc(var(--kw) / 2 + (100% - var(--kw)) * ${m.get().toFixed(4)})`; knob.style.left = x; fill.style.width = x; }
      f.setAttribute('aria-valuetext', m.text()); });
    return f;
  }
  /** Číslo hodnoty: čeká na pult = kurzíva s „…“ (zákon 2); u faderů tlačítko s nabídkou 0 dB / −6 dB / −∞. */
  function valText(m, cls, menu) {
    const e = el(menu ? 'button' : 'div', cls || 'val');
    if (menu) { e.type = 'button'; e.setAttribute('aria-haspopup', 'menu'); e.addEventListener('click', () => dbMenu(e, m)); }
    else e.setAttribute('aria-hidden', 'true');
    W.push(() => { const p = m.pend(); e.classList.toggle('pend', p); e.textContent = m.text() + (p ? '…' : '');
      if (menu) e.setAttribute('aria-label', m.label + ' ' + m.text() + ' dB – ' + t('menu')); });
    return e;
  }
  function prow(label, m, color, cls) {
    const r = el('div', 'prow ' + (cls || '')); r.append(el('span', '', label), hSlider(m, color), valText(m, 'v'));
    return r;
  }
  let menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  function dbMenu(anchor, m) {
    closeMenu(); if (!m.known()) return;
    const box = el('div', 'menu'); box.setAttribute('role', 'menu');
    [['0 dB', dbf(0)], ['−6 dB', dbf(-6)], ['−∞', 0]].forEach(([l, v]) => {
      const b = el('button', '', l); b.setAttribute('role', 'menuitem');
      b.onclick = () => { closeMenu(); act(m.label + ' ' + l, () => m.set(v)); anchor.focus(); };
      box.append(b);
    });
    document.body.append(box);
    const r = anchor.getBoundingClientRect();
    box.style.left = Math.min(innerWidth - 170, Math.max(8, r.left)) + 'px';
    box.style.top = Math.max(8, r.top - box.offsetHeight - 6) + 'px';
    menuEl = box; box.firstChild.focus();
    box.addEventListener('keydown', e => { if (e.key === 'Escape') { closeMenu(); anchor.focus(); } });
  }
  document.addEventListener('pointerdown', e => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, true);
  function meter(i, stereo) {
    const box = el('div', 'meter' + (stereo ? ' st' : ''));
    if (stereo) { const a = meter(i), b = meter(i + 1); box.className = 'meter st'; box.style.background = 'none'; box.append(a, b); return box; }
    box.innerHTML = '<i></i>'; box.dataset.m = i; box.setAttribute('aria-hidden', 'true'); return box;
  }
  function scale() {
    const s = el('div', 'scale'); s.setAttribute('aria-hidden', 'true');
    for (const [x, v] of TICKS) { const n = el('span', x === '0' ? 'z' : '', x); n.style.top = posV(v); s.append(n); }
    return s;
  }
  /** Přepínač pultu 0/1 (48 V, Low cut, EQ…): svítí sand = zapnuto (červená je jen MUTE). */
  function swBtn(a, label, txtOn, txtOff, extra) {
    const b = btn('sw', label);
    b.onclick = () => { if (!known(a)) return; act(label + ' ' + (val(a) === 1 ? t('offW') : t('onW')), () => w(a, val(a) === 1 ? 0 : 1)); };
    W.push(() => { const on = val(a) === 1; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); b.disabled = !known(a);
      b.textContent = on ? (txtOn || label) : (txtOff || label); b.classList.toggle('pend', pend(a)); if (extra) extra(on); });
    return b;
  }
  /** Tlačítko „zmáčkni dvakrát do 5 s“ s odpočtem (nevratné / velké akce: načíst píseň, přepsat). */
  function armed(b, label, armText, fn) {
    let armedAt = 0, timer = 0;
    const reset = () => { armedAt = 0; clearInterval(timer); b.classList.remove('armed'); b.textContent = typeof label === 'function' ? label() : label; };
    b.textContent = typeof label === 'function' ? label() : label;
    b.addEventListener('click', () => {
      if (!armedAt) {
        if (!online()) { offline(); return; }
        armedAt = Date.now(); b.classList.add('armed');
        const tick = () => { const s = 5 - Math.floor((Date.now() - armedAt) / 1000); if (s <= 0) return reset(); b.textContent = armText() + ' ' + s + ' s'; };
        tick(); timer = setInterval(tick, 250); say(t('confirm5', armText())); return;
      }
      reset(); fn();
    });
    b._reset = reset;
    return b;
  }

  // MARK: - kanál: dlaždice, důvod ztlumení
  function chColor(s) { return s.owner ? mcol(s.owner) : ''; }
  function tile(s, interactive) {
    const e = el(interactive ? 'button' : 'div', 'tile'); if (interactive) e.type = 'button';
    const c = chColor(s); if (c) e.style.setProperty('--cc', c);
    e.append(el('small', '', s.pair ? s.short + '–' + (+s.short + 1) : s.short), el('b', '', s.name));
    if (s.owner) { const o = el('span', 'own', mname(s.owner).charAt(0)); o.setAttribute('aria-hidden', 'true'); e.append(o);
      e.setAttribute('aria-description', t('ownerOf', mname(s.owner))); }
    return e;
  }
  function groupOf(s) { for (let g = 1; g <= 4; g++) if ((s.muteMask & (1 << (g - 1))) && val('/config/mute/' + g) === 1) return g; return 0; }
  function dcaOf(s) { for (let g = 1; g <= 4; g++) if ((s.dcaMask & (1 << (g - 1))) && val('/dca/' + g + '/on') === 0) return g; return 0; }
  /** Text MUTE podle slovníku: „MUTE“ nesvítí / svítí červeně (přímo), „MG1“ / „DCA1“ oranžově (nepřímo). */
  function muteBtn(s) {
    const b = btn('mute', 'MUTE');
    b.onclick = () => { if (!known(s.on)) return; act((val(s.on) === 1 ? t('muteAct') : t('unmuteAct')) + ' ' + s.name, () => w(s.on, val(s.on) === 1 ? 0 : 1)); };
    W.push(() => {
      const direct = val(s.on) === 0, g = groupOf(s), d = dcaOf(s);
      b.classList.toggle('on', direct); b.classList.toggle('ind', !direct && !!(g || d));
      b.textContent = direct ? (ST.concert ? t('mutedBig') : 'MUTE') : g ? t('mg', g) : d ? 'DCA' + d : 'MUTE';
      b.setAttribute('aria-pressed', direct);
      b.setAttribute('aria-label', s.name + ' MUTE' + (direct ? ' – ' + t('mutedBig') : g ? ' – ' + t('viaGroup', t('mg', g)) : d ? ' – ' + t('viaGroup', 'DCA' + d) : ''));
      b.classList.toggle('pend', pend(s.on));
    });
    return b;
  }
  function select(id) { if (!byId[id]) return; ST.sel = id; hub.select(id); sched(); }

  // MARK: - drž-tlačítko MLUVIT (pustí se zvednutím prstu, ztrátou fokusu i skrytím stránky – zákon v10 č. 7)
  function holdTalk(b, targets, idle, lit) {
    let mine = false;
    const start = () => {
      if (mine) return;
      if (!online()) { offline(); return; }
      if (!hub.talk(true, 'ipad', targets())) { toast(t('talkBusy'), true); return; }
      mine = true; sched();
    };
    const stop = () => { if (!mine) return; mine = false; hub.talk(false, 'ipad'); sched(); };
    b.addEventListener('pointerdown', e => { e.preventDefault(); if (ST.toggleTalk) { mine ? stop() : start(); } else start(); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(x => b.addEventListener(x, () => { if (!ST.toggleTalk) stop(); }));
    b.addEventListener('click', e => { if (e.detail === 0) mine ? stop() : start(); });   // klávesnice / VoiceOver přepíná
    b.addEventListener('blur', () => { if (!ST.toggleTalk) stop(); });
    releasers.push(stop);
    W.push(() => { const on = mine && !!hub.talkInfo(); if (mine && !hub.talkInfo()) mine = false;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); b.textContent = on ? lit() : idle(); });
    return b;
  }
  const releasers = [];
  const releaseAll = () => { releasers.forEach(f => f()); if (keyTalk) { keyTalk = false; hub.talk(false, 'ipad'); } };
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });

  // MARK: - horní lišta, spodní lišta
  let keyTalk = false;
  const PAGES = ['mixer', 'channel', 'monitors', 'scenes', 'band', 'settings'];
  const CONCERT_OK = ['mixer', 'monitors'];
  function buildChrome() {
    $('hubChip').textContent = t('hubChip');
    const nav = $('nav'); nav.setAttribute('aria-label', t('pages'));
    PAGES.forEach(p => {
      const b = el('button', '', t('page_' + p)); b.type = 'button'; b.dataset.p = p; b.id = 'nav-' + p;
      b.onclick = () => { if (ST.concert && !CONCERT_OK.includes(p)) { toast(t('concertLocked')); return; } go(p); };
      nav.append(b);
    });
    const seg = $('modeSeg'); seg.setAttribute('aria-label', t('mode'));
    [['reh', t('rehearsal')], ['con', t('concert')]].forEach(([k, l]) => {
      const b = el('button', '', l); b.type = 'button'; b.id = 'mode-' + k;
      b.onclick = () => setConcert(k === 'con'); seg.append(b);
    });
    $('undoB').onclick = doUndo;
    $('chanB').onclick = () => go('channel');
    WG.push(() => {
      const ok = online();
      $('conn').className = 'chip ' + (ok ? 'ok' : 'warn');
      $('connT').textContent = ok ? t('connOk') : t('connLost');
      document.body.classList.toggle('off', !ok);
      $('banner').textContent = t('bannerOff');
      nav.querySelectorAll('button').forEach(b => {
        b.setAttribute('aria-current', b.dataset.p === ST.page ? 'page' : 'false');
        b.setAttribute('aria-disabled', ST.concert && !CONCERT_OK.includes(b.dataset.p));
      });
      $('mode-reh').setAttribute('aria-pressed', !ST.concert); $('mode-con').setAttribute('aria-pressed', ST.concert);
      const u = $('undoB'); u.disabled = !undo.length; u.textContent = undo.length ? t('undoWhat', lastUndo()) : t('undoNone');
      const s = byId[ST.sel];
      $('chanB').hidden = ST.concert || ST.page === 'channel';
      $('chanB').textContent = t('openChannel', s ? s.name : '');
      const c = hub.controller();
      $('ctrlChip').hidden = !c; $('ctrlChip').textContent = c ? t('ctrlChip', c, ST.bank + 1) : '';
    });
  }
  function setConcert(on) {
    ST.concert = !!on; store.set('concert', ST.concert);
    document.body.classList.toggle('concert', ST.concert);
    if (ST.concert && !CONCERT_OK.includes(ST.page)) ST.page = 'mixer';
    say(ST.concert ? t('concertOn') : t('concertOff'));
    render();
  }
  function go(p) { ST.page = p; closeMenu(); render(); const n = $('nav-' + p); if (n && document.activeElement && document.activeElement.closest && document.activeElement.closest('nav')) n.focus(); }

  // MARK: - banky (8 pásů = F1–F8 ovladače); iPad a ovladač jdou spolu
  const BANK = 8;
  const nBanks = () => Math.ceil(SL.length / BANK);
  function buildBanks(stripsEl) {
    const box = $('banks'); box.innerHTML = ''; box.hidden = !stripsEl;
    box.setAttribute('aria-label', t('banks'));
    if (!stripsEl) return;
    for (let k = 0; k < nBanks(); k++) {
      const first = SL[k * BANK], lastS = SL[Math.min(SL.length, (k + 1) * BANK) - 1];
      const b = el('button', 'bank', t('bank', k + 1)); b.type = 'button';
      b.setAttribute('aria-label', t('bank', k + 1) + ': ' + first.name + ' – ' + lastS.name);
      b.onclick = () => { scrollBank(stripsEl, k); hub.requestBank(k); };
      box.append(b);
    }
    stripsEl.addEventListener('scroll', () => paintBanks(stripsEl), {passive: true});
    W.push(() => paintBanks(stripsEl));
  }
  function scrollBank(sc, k) { const first = sc.children[k * BANK]; if (first) sc.scrollTo({left: first.offsetLeft - sc.firstElementChild.offsetLeft, behavior: 'auto'}); }
  function paintBanks(sc) {
    let k = 0;
    if (sc.scrollLeft + sc.clientWidth >= sc.scrollWidth - 2) k = nBanks() - 1;
    else { const kids = [...sc.children]; const i = kids.findIndex(c => c.offsetLeft - kids[0].offsetLeft + c.offsetWidth / 2 >= sc.scrollLeft); k = Math.floor(Math.max(0, i) / BANK); }
    if (sc.scrollLeft < 2) k = 0;
    $('banks').querySelectorAll('.bank').forEach((b, i) => b.setAttribute('aria-pressed', i === k));
  }
  let stripsNow = null;
  const onBank = e => { ST.bank = e.bank; if (stripsNow) scrollBank(stripsNow, e.bank); sched(); };

  // MARK: - Mixer
  function mixLane(s, i) {
    const lane = el('section', 'lane'); lane.dataset.id = s.id; lane.setAttribute('aria-label', s.name);
    const c = chColor(s); if (c) lane.style.setProperty('--cc', c);
    const badge = el('span', 'fbadge'); lane.append(badge);
    const tl = tile(s, true); tl.setAttribute('aria-label', t('selectCh', s.name)); tl.onclick = () => select(s.id);
    lane.append(tl);
    if (s.pan) {
      const pm = {label: t('panOf', s.name), get: () => val(s.pan), known: () => known(s.pan), pend: () => pend(s.pan), keys: [s.pan],
        set: v => w(s.pan, Math.round(v * 100) / 100), step: d => Math.min(1, Math.max(0, val(s.pan) + d * 0.05)), home: () => 0.5,
        text: () => { const p = Math.round((val(s.pan) - 0.5) * 200); return p === 0 ? 'C' : (p < 0 ? 'L' : 'R') + Math.abs(p); }};
      const pn = el('div', 'pan reh'); pn.setAttribute('role', 'slider'); pn.setAttribute('aria-label', pm.label); pn.tabIndex = 0;
      const k = el('i'), lab = el('span', '', 'C'); pn.append(lab, k);
      bindDrag(pn, pm, true, () => pn.clientWidth * 1.5);
      W.push(() => { k.style.left = `calc(8px + (100% - 16px) * ${val(s.pan).toFixed(3)})`; lab.textContent = pm.text(); lab.classList.toggle('pend', pend(s.pan)); pn.setAttribute('aria-valuetext', pm.text()); });
      lane.append(pn);
    }
    const fm = faderModel(s.fader, s.name);
    const fw = el('div', 'fw'); fw.append(scale(), vFader(fm, c), meter(s.meter, s.kind !== 'ch'));
    lane.append(fw, valText(fm, 'val', true));
    const bs = el('div', 'btns');
    if (s.solo) {
      const so = btn('solo reh', 'SOLO');
      so.onclick = () => act('SOLO ' + s.name, () => w(s.solo, val(s.solo) === 1 ? 0 : 1));
      W.push(() => { const on = val(s.solo) === 1; so.classList.toggle('on', on); so.setAttribute('aria-pressed', on); so.setAttribute('aria-label', 'SOLO ' + s.name); });
      bs.append(so);
    }
    bs.append(muteBtn(s)); lane.append(bs);
    W.push(() => {
      lane.classList.toggle('sel', ST.sel === s.id);
      lane.classList.toggle('dim', !!hub.silenceReason(s.id));
      const inBank = Math.floor(i / BANK) === ST.bank && !!hub.controller();
      badge.hidden = !inBank; badge.textContent = 'F' + (i % BANK + 1);
    });
    return lane;
  }
  function houseLane() {
    const lane = el('section', 'lane mainl'); lane.setAttribute('aria-label', t('house'));
    const tl = el('div', 'tile plain'); tl.append(el('small', '', 'LR'), el('b', '', t('house'))); lane.append(tl);
    const fm = faderModel('/lr/mix/fader', t('house'));
    const fw = el('div', 'fw'); fw.append(scale(), vFader(fm, ''), meter(36, true));
    const mb = btn('mute', 'MUTE');
    mb.onclick = () => act((val('/lr/mix/on') === 1 ? t('muteAct') : t('unmuteAct')) + ' ' + t('house'), () => w('/lr/mix/on', val('/lr/mix/on') === 1 ? 0 : 1));
    W.push(() => { const m = val('/lr/mix/on') === 0; mb.classList.toggle('on', m); mb.setAttribute('aria-pressed', m); mb.textContent = m && ST.concert ? t('mutedBig') : 'MUTE'; mb.setAttribute('aria-label', t('house') + ' MUTE'); });
    const bs = el('div', 'btns'); bs.append(mb);
    lane.append(fw, valText(fm, 'val', true), bs);
    return lane;
  }
  function liveActions(side) {
    const h = el('div', 'hcap'); h.append(el('span', '', t('liveActions')), el('small', '', ST.keys ? t('spaceIsMg1') : ''));
    const gg = el('div', 'groups'); gg.setAttribute('role', 'group'); gg.setAttribute('aria-label', t('muteGroups'));
    for (let g = 1; g <= 4; g++) {
      const a = '/config/mute/' + g, b = el('button', 'sk'); b.type = 'button'; b.id = 'mg' + g;
      b.append(el('b', '', t('mg', g)), el('span', '', hub.groupName(g)));
      b.onclick = () => act(t('mg', g) + ' ' + hub.groupName(g), () => w(a, val(a) === 1 ? 0 : 1));
      W.push(() => { const on = val(a) === 1; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
        b.setAttribute('aria-label', t('mg', g) + ' ' + hub.groupName(g) + ' – ' + t('muteGroup') + (on ? ', ' + t('mgOn') : '')); b.classList.toggle('pend', pend(a)); });
      gg.append(b);
    }
    const all = btn('mute wide', '', () => {
      const allOff = MEMBERS.every(b => val('/bus/' + b + '/mix/on') === 0);
      if (allOff) { act(t('monOnAct'), () => MEMBERS.forEach(b => w('/bus/' + b + '/mix/on', 1))); toast(t('monBack')); return; }
      act(t('monOffAct'), () => MEMBERS.forEach(b => w('/bus/' + b + '/mix/on', 0)));
      toast(t('monMuted'), false, t('undoBtn'), doUndo);
    });
    all.id = 'allMon';
    W.push(() => { const on = MEMBERS.every(b => val('/bus/' + b + '/mix/on') === 0); all.classList.toggle('on', on); all.setAttribute('aria-pressed', on); all.textContent = on ? t('monMutedBtn') : t('muteAllMon'); });
    const two = el('div', 'btns');
    const mc = btn('ivory', t('mcMode'), () => { const on = !hub.mc(); if (!hub.setMc(on)) { offline(); return; } toast(on ? t('mcOnToast') : t('mcOffToast')); });
    W.push(() => { mc.classList.toggle('on', hub.mc()); mc.setAttribute('aria-pressed', hub.mc()); mc.textContent = hub.mc() ? t('mcModeOn') : t('mcMode'); });
    const q = btn('warnline', '−6 dB', () => {
      act(t('quietAllAct'), () => MEMBERS.forEach(b => { const a = '/bus/' + b + '/mix/fader', d = lin(val(a)); if (isFinite(d) && d > -60) w(a, dbf(Math.max(-60, d - 6))); }));
      toast(t('quietAll'), false, t('undoBtn'), doUndo);
    });
    q.id = 'quietAll'; q.setAttribute('aria-label', t('quietAllLabel'));
    two.append(mc, q);
    side.append(h, gg, all, two);
  }
  function talkBlock(side) {
    const h = el('div', 'hcap'); h.append(el('span', '', t('talkH')), el('small', '', t('talkTo')));
    const chips = el('div', 'talkto'); chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', t('talkTo'));
    const allB = el('button', '', t('all')); allB.type = 'button';
    allB.onclick = () => { ST.talkTo = ST.talkTo.length === 4 ? [] : MEMBERS.slice(); hub.talkTargets(ST.talkTo); sched(); };
    chips.append(allB);
    const mb = MEMBERS.map(b => { const x = el('button', '', mname(b).slice(0, 3) + '.'); x.type = 'button'; x.style.setProperty('--mc', mcol(b));
      x.setAttribute('aria-label', t('talkToWho', mname(b)));
      x.onclick = () => { ST.talkTo = ST.talkTo.includes(b) ? ST.talkTo.filter(y => y !== b) : ST.talkTo.concat(b).sort(); hub.talkTargets(ST.talkTo); sched(); };
      chips.append(x); return x; });
    W.push(() => { allB.setAttribute('aria-pressed', ST.talkTo.length === 4); mb.forEach((x, i) => x.setAttribute('aria-pressed', ST.talkTo.includes(i + 1))); });
    const tb = el('button', 'talk'); tb.type = 'button'; tb.id = 'talk';
    holdTalk(tb, () => ST.talkTo.length ? ST.talkTo : MEMBERS, () => ST.toggleTalk ? t('talkIdleToggle') : t('talkIdle'), () => t('talkLit'));
    side.append(h, chips, tb, el('div', 'note', t('talkHint', hub.talkMic())));
  }
  function dcaBlock(side) {
    const h = el('div', 'hcap reh'); h.append(el('span', '', 'DCA'), el('small', '', t('dcaSub')));
    side.append(h);
    for (let g = 1; g <= 4; g++) {
      const fa = '/dca/' + g + '/fader', oa = '/dca/' + g + '/on';
      const r = el('div', 'dca reh'); r.setAttribute('role', 'group'); r.setAttribute('aria-label', 'DCA ' + hub.dcaName(g));
      const fm = faderModel(fa, 'DCA ' + hub.dcaName(g));
      const nm = el('div', 'nm', hub.dcaName(g)); nm.append(valText(fm, 'dv'));
      const mb = btn('mute', 'MUTE', () => act((val(oa) === 1 ? t('muteAct') : t('unmuteAct')) + ' DCA ' + hub.dcaName(g), () => w(oa, val(oa) === 1 ? 0 : 1)));
      W.push(() => { const m = val(oa) === 0; mb.classList.toggle('on', m); mb.setAttribute('aria-pressed', m); mb.setAttribute('aria-label', 'DCA ' + hub.dcaName(g) + ' MUTE'); });
      r.append(nm, hSlider(fm), mb); side.append(r);
    }
    side.append(el('div', 'note con', t('concertNote')));
  }
  function nowBar() {
    const bar = el('div', 'nowbar con');
    const a = el('div'), b = el('div');
    const now = el('div', 'now'), nx = el('div', 'nx');
    a.append(el('div', 'k', t('playing')), now); b.append(el('div', 'k', t('next')), nx);
    const prev = btn('', '◀', () => hub.cue(Math.max(0, hub.next() - 1))); prev.setAttribute('aria-label', t('prevSong'));
    const next = btn('', '▶', () => hub.cue(Math.min(hub.setlist().length - 1, hub.next() + 1))); next.setAttribute('aria-label', t('nextSong'));
    const load = armed(btn('prim big'), () => t('loadSong', hub.setlist()[hub.next()].name), () => t('loadAgain'), () => loadSong(hub.next()));
    load.id = 'loadNext';
    bar.append(a, b, el('span', 'grow'), prev, next, load);
    W.push(() => { const L = hub.setlist(); now.textContent = L[hub.playing()] ? L[hub.playing()].name : '—'; nx.textContent = L[hub.next()] ? L[hub.next()].name : '—';
      if (!load.classList.contains('armed')) load.textContent = t('loadSong', nx.textContent); });
    return bar;
  }
  function loadSong(i) {
    const L = hub.setlist(); if (!L[i]) return;
    const scope = Object.keys(ST.scope).filter(k => ST.scope[k]);
    const r = hub.loadSong(i, scope, ST.smooth);
    if (!r) { offline(); return; }
    const g = {label: t('loadAct', L[i].name), b: {}};
    r.rows.forEach(x => { g.b[x.a] = x.now; }); r.monitors.forEach(x => { g.b[x.a] = x.now; });
    if (Object.keys(g.b).length) undo.push(g);
    const faders = r.rows.filter(x => /fader$/.test(x.a)).length;
    toast(r.monitors.length ? t('loadedOwn', L[i].name, faders) : t('loaded', L[i].name, faders), false, t('undoBtn'), doUndo);
    sched();
  }
  function buildMixer(page) {
    const col = el('div', 'mixcol');
    col.append(nowBar());
    const sc = el('div', 'strips'); sc.id = 'strips'; sc.setAttribute('role', 'group'); sc.setAttribute('aria-label', t('channels'));
    SL.forEach((s, i) => sc.append(mixLane(s, i)));
    col.append(sc);
    const side = el('aside', 'side'); side.setAttribute('aria-label', t('liveActions'));
    liveActions(side); talkBlock(side); dcaBlock(side);
    page.append(col, side, houseLane());
    stripsNow = sc; buildBanks(sc);
    requestAnimationFrame(() => scrollBank(sc, ST.bank));
  }

  // MARK: - Kanál
  const chOf = () => byId[ST.sel] && byId[ST.sel].kind === 'ch' ? byId[ST.sel] : CH[0];
  function bandResp(type, f0, g, q, f) {
    const x = Math.log2(f / f0);
    switch (type) {
      case 2: case 3: { const y = x * q * 1.4; return g * Math.exp(-y * y); }
      case 1: return g / (1 + Math.pow(f / f0, 2 * Math.max(0.5, q / 2)));
      case 4: return g / (1 + Math.pow(f0 / f, 2 * Math.max(0.5, q / 2)));
      case 0: return 10 * Math.log10(1 / (1 + Math.pow(f0 / f, 4)));
      case 5: return 10 * Math.log10(1 / (1 + Math.pow(f / f0, 4)));
    }
    return 0;
  }
  const BANDC = ['#8CADEB', '#D199DB', '#E6D185', '#8FCC94'];   // barvy pásem EQ (jako v appce), jen v grafu
  function eqGraph(s) {
    const c = s.id, W0 = 360, H0 = 150;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${W0} ${H0}`); svg.setAttribute('class', 'gfx'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', t('eqGraph', s.name));
    svg.style.height = '150px';
    const ns = n => document.createElementNS('http://www.w3.org/2000/svg', n);
    const fx = f => Math.log(f / 20) / Math.log(1000) * W0, gy = g => H0 / 2 - g / 15 * (H0 / 2 - 8);
    [100, 1000, 10000].forEach(f => { const l = ns('line'); l.setAttribute('x1', fx(f)); l.setAttribute('x2', fx(f)); l.setAttribute('y1', 0); l.setAttribute('y2', H0); l.setAttribute('stroke', '#ffffff14'); svg.append(l); });
    const zl = ns('line'); zl.setAttribute('x1', 0); zl.setAttribute('x2', W0); zl.setAttribute('y1', H0 / 2); zl.setAttribute('y2', H0 / 2); zl.setAttribute('stroke', '#ffffff30'); svg.append(zl);
    const path = ns('path'); path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'var(--krai-sand)'); path.setAttribute('stroke-width', '2.5'); svg.append(path);
    const dots = [1, 2, 3, 4].map(i => { const d = ns('circle'); d.setAttribute('r', 9); d.setAttribute('fill', BANDC[i - 1]); d.setAttribute('stroke', '#0C1014'); d.setAttribute('stroke-width', 2); svg.append(d); return d; });
    const P0 = i => c + '/eq/' + i + '/';
    W.push(() => {
      const on = val(c + '/eq/on') === 1, hp = val(c + '/preamp/hpon') === 1, hpf = X.hpfHz(val(c + '/preamp/hpf'));
      let d = '';
      for (let k = 0; k <= 120; k++) {
        const f = 20 * Math.pow(1000, k / 120); let g = 0;
        if (on) for (let i = 1; i <= 4; i++) g += bandResp(val(P0(i) + 'type'), X.eqHz(val(P0(i) + 'f')), X.eqDb(val(P0(i) + 'g')), X.eqQ(val(P0(i) + 'q')), f);
        if (hp) g += 10 * Math.log10(1 / (1 + Math.pow(hpf / f, 4)));
        d += (k ? 'L' : 'M') + (k / 120 * W0).toFixed(1) + ' ' + Math.min(H0, Math.max(0, gy(g))).toFixed(1);
      }
      path.setAttribute('d', d); path.style.opacity = on ? 1 : 0.4;
      dots.forEach((dt, i) => { dt.setAttribute('cx', fx(X.eqHz(val(P0(i + 1) + 'f')))); dt.setAttribute('cy', gy(X.eqDb(val(P0(i + 1) + 'g')))); dt.setAttribute('opacity', i + 1 === ST.eqBand ? 1 : 0.65); });
    });
    // tah bodem: ↔ frekvence, ↕ zisk (jeden krok Zpět za celý tah)
    let drag = null;
    svg.addEventListener('pointerdown', e => {
      if (!online()) { offline(); return; }
      const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * W0, y = (e.clientY - r.top) / r.height * H0;
      let best = 0, bd = 1e9;
      for (let i = 1; i <= 4; i++) { const dx = fx(X.eqHz(val(P0(i) + 'f'))) - x, dy = gy(X.eqDb(val(P0(i) + 'g'))) - y, dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = i; } }
      ST.eqBand = best; svg.setPointerCapture(e.pointerId); drag = {id: e.pointerId, r};
      begin(t('eqBandAct', best, s.name)); dragging.add(P0(best) + 'f'); dragging.add(P0(best) + 'g'); sched();
    });
    svg.addEventListener('pointermove', e => {
      if (!drag || drag.id !== e.pointerId) return;
      const x = Math.min(1, Math.max(0, (e.clientX - drag.r.left) / drag.r.width)), y = Math.min(1, Math.max(0, (e.clientY - drag.r.top) / drag.r.height));
      const g = Math.max(-15, Math.min(15, (0.5 - y) * 2 * 15 * (H0 / 2) / (H0 / 2 - 8)));
      const b = ST.eqBand;
      if (val(c + '/eq/on') !== 1) w(c + '/eq/on', 1);
      w(P0(b) + 'f', x); w(P0(b) + 'g', X.eqDbF(g));
    });
    const stop = e => { if (!drag || drag.id !== e.pointerId) return; drag = null; dragging.clear(); end(); };
    svg.addEventListener('pointerup', stop); svg.addEventListener('pointercancel', stop);
    return svg;
  }
  function dynGraph(s, kind) {
    const c = s.id, W0 = 230, H0 = 120, lo = kind === 'gate' ? -80 : -60;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${W0} ${H0}`); svg.setAttribute('class', 'gfx'); svg.style.height = '120px';
    svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', t(kind === 'gate' ? 'gateGraph' : 'compGraph', s.name));
    const ns = n => document.createElementNS('http://www.w3.org/2000/svg', n);
    const X0 = d => (d - lo) / -lo * W0, Y0 = d => H0 - (d - lo) / -lo * H0;
    const diag = ns('path'); diag.setAttribute('d', `M0 ${H0} L${W0} 0`); diag.setAttribute('stroke', '#ffffff20'); svg.append(diag);
    const path = ns('path'); path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'var(--krai-sand)'); path.setAttribute('stroke-width', '2.5'); svg.append(path);
    const thrL = ns('line'); thrL.setAttribute('stroke', '#ffffff40'); thrL.setAttribute('stroke-dasharray', '3 3'); thrL.setAttribute('y1', 0); thrL.setAttribute('y2', H0); svg.append(thrL);
    const dot = ns('circle'); dot.setAttribute('r', 5); dot.setAttribute('fill', 'var(--krai-ok)'); svg.append(dot);
    const out = d => {
      if (kind === 'gate') { const th = X.gateThr(val(c + '/gate/thr')); return d < th ? d - X.gateRange(val(c + '/gate/range')) : d; }
      const th = X.compThr(val(c + '/dyn/thr')), r = X.RATIOS[val(c + '/dyn/ratio')] || 1; return d > th ? th + (d - th) / r : d;
    };
    W.push(() => {
      let d = '';
      for (let k = 0; k <= 60; k++) { const x = lo + (-lo) * k / 60; d += (k ? 'L' : 'M') + X0(x).toFixed(1) + ' ' + Math.min(H0, Math.max(0, Y0(out(x)))).toFixed(1); }
      path.setAttribute('d', d);
      const th = kind === 'gate' ? X.gateThr(val(c + '/gate/thr')) : X.compThr(val(c + '/dyn/thr'));
      thrL.setAttribute('x1', X0(th)); thrL.setAttribute('x2', X0(th));
    });
    dotFns.push(() => { const lv = Math.max(lo, Math.min(0, hub.inputLevel(s.n))); dot.setAttribute('cx', X0(lv)); dot.setAttribute('cy', Math.min(H0, Math.max(0, Y0(out(lv))))); dot.style.opacity = online() ? 1 : 0; });
    // tah v grafu = práh
    const thA = kind === 'gate' ? c + '/gate/thr' : c + '/dyn/thr';
    bindDrag(svg, paramModel(thA, t('thr'), kind === 'gate' ? 161 : 121, v => v), true, () => svg.clientWidth);
    return svg;
  }
  let dotFns = [];
  function sendCard(s, b) {
    const a = s.send(b), card = el('div', 'sendc'); card.style.setProperty('--mc', mcol(b));
    const m = faderModel(a, t('sendLabel', s.name, mname(b)));
    card.append(el('span', 'who-n', mname(b)), valText(m, 'v'), hSlider(m, mcol(b)), hearsBtn(s, b));
    return card;
  }
  /** SLYŠÍ / VYPNUTO: XR18 nemá vypínač sendu – appka ho emuluje úrovní 0 a pamatuje si, kde byl. */
  const sendMem = {};
  function hearsBtn(s, b) {
    const a = s.send(b), x = btn('mute', '');
    x.onclick = () => {
      if (!known(a)) return;
      if (val(a) > 0) { sendMem[a] = val(a); act(t('sendOffAct', s.name, mname(b)), () => w(a, 0)); }
      else act(t('sendOnAct', s.name, mname(b)), () => w(a, sendMem[a] || dbf(-10)));
    };
    W.push(() => { const off = known(a) && val(a) === 0; x.classList.toggle('on', off); x.textContent = off ? t('sendOff') : t('hears'); x.setAttribute('aria-pressed', off);
      x.setAttribute('aria-label', off ? t('sendOffLabel', s.name, mname(b)) : t('hearsLabel', s.name, mname(b))); });
    return x;
  }
  function clarityModel(s) {
    const c = s.id, g2 = c + '/eq/2/g', g3 = c + '/eq/3/g';
    return macroModel(t('clarity'), () => Math.max(0, Math.min(10, Math.round(-X.eqDb(val(g2)) / 0.6))),
      n => { if (val(c + '/eq/on') !== 1) w(c + '/eq/on', 1); w(g2, X.eqDbF(-0.6 * n)); w(g3, X.eqDbF(0.3 * n)); }, [g2, g3], n => n + ' / 10');
  }
  function evenModel(s) {
    const c = s.id, on = c + '/dyn/on', thr = c + '/dyn/thr', ra = c + '/dyn/ratio';
    return macroModel(t('evenness'), () => val(on) !== 1 ? 0 : Math.max(1, Math.min(10, Math.round((-6 - X.compThr(val(thr))) / 2.4))),
      n => { if (!n) { w(on, 0); return; } if (val(on) !== 1) w(on, 1); w(thr, X.compThrF(-6 - 2.4 * n)); w(ra, X.ratioIndex(1.5 + 0.45 * n)); }, [on, thr, ra], n => n ? n + ' / 10' : t('offW'));
  }
  function buildChannel(page) {
    const s = chOf(); ST.sel = s.id;
    const col = el('div', 'col');
    // výběr kanálu
    const pick = el('div', 'chpick');
    const idx = CH.indexOf(s);
    const pv = btn('', '◀', () => { select(CH[(idx - 1 + CH.length) % CH.length].id); render(); }); pv.setAttribute('aria-label', t('prevCh'));
    const nx = btn('', '▶', () => { select(CH[(idx + 1) % CH.length].id); render(); }); nx.setAttribute('aria-label', t('nextCh'));
    const chips = el('div', 'chips'); chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', t('channels'));
    CH.forEach(k => { const b = el('button', 'chc', k.name); b.type = 'button'; const cc = chColor(k); if (cc) b.style.setProperty('--cc', cc);
      b.setAttribute('aria-pressed', k.id === s.id); b.onclick = () => { select(k.id); render(); }; chips.append(b); });
    pick.append(pv, chips, nx);
    // hlavička
    const head = el('div', 'chhead');
    const g = s.muteMask ? [1, 2, 3, 4].filter(x => s.muteMask & (1 << (x - 1))) : [];
    const d = [1, 2, 3, 4].filter(x => s.dcaMask & (1 << (x - 1)));
    head.append(tile(s, false), el('div', 'meta', t('chMeta', s.short + (s.pair ? '–' + (+s.short + 1) : ''), s.pair,
      g.map(x => t('mg', x) + ' ' + hub.groupName(x)).join(', '), d.map(x => 'DCA ' + hub.dcaName(x)).join(', '))));
    const vw = el('div', 'seg'); vw.setAttribute('role', 'group'); vw.setAttribute('aria-label', t('view'));
    [['simple', t('simple')], ['full', t('fullChain')]].forEach(([k, l]) => { const b = el('button', '', l); b.type = 'button'; b.id = 'view-' + k;
      b.setAttribute('aria-pressed', ST.chView === k); b.onclick = () => { ST.chView = k; store.set('chView', k); render(); }; vw.append(b); });
    head.append(vw);
    col.append(pick, head);
    const c = s.id, hn = '/headamp/' + pad(s.n);
    if (ST.chView === 'simple') {
      const box = el('div', 'simple');
      const card = el('section', 'card'); card.id = 'simpleCard';
      card.append(el('h3', '', t('soundsRight', s.name)));
      const vol = faderModel(s.fader, t('volume'));
      card.append(prow(t('volume'), vol, chColor(s)), el('p', 'desc', t('volumeDesc', s.name)));
      const cl = clarityModel(s); const clRow = prow(t('clarity'), cl); clRow.id = 'clarityRow';
      card.append(clRow, el('p', 'desc', t('clarityDesc')));
      const ev = evenModel(s); const evRow = prow(t('evenness'), ev); evRow.id = 'evenRow';
      card.append(evRow, el('p', 'desc', t('evenDesc')));
      const tg = el('div', 'row');
      tg.append(swBtn(c + '/preamp/hpon', t('lowCut')), swBtn(hn + '/phantom', '48 V'), btn('', t('fullChainGo'), () => { ST.chView = 'full'; store.set('chView', 'full'); render(); }));
      card.append(tg, prow(t('lowCut'), paramModel(c + '/preamp/hpf', t('lowCutFreq'), 101, v => Math.round(X.hpfHz(v)) + ' Hz')));
      const right = el('section', 'card');
      right.append(el('div', 'hcap', t('whatChanged')), el('p', 'note', t('macroNote')));
      const sum = el('div', 'note'); sum.style.marginTop = '8px';
      W.push(() => { sum.textContent = t('macroSummary', sgn(X.eqDb(val(c + '/eq/2/g')), 1), sgn(X.eqDb(val(c + '/eq/3/g')), 1),
        val(c + '/dyn/on') === 1 ? Math.round(X.compThr(val(c + '/dyn/thr'))) + ' dB · ' + X.RATIOS[val(c + '/dyn/ratio')] + ':1' : t('offW')); });
      right.append(sum, el('div', 'hcap', t('inputLevel')));
      const im = el('div', 'grbar'); const imi = el('i'); imi.style.background = 'var(--krai-ok)'; imi.style.left = '0'; imi.style.right = 'auto'; im.append(imi);
      dotFns.push(() => { const l = online() ? hub.inputLevel(s.n) : -90; imi.style.width = Math.max(0, Math.min(100, (l + 60) / 60 * 100)) + '%'; });
      right.append(im);
      box.append(card, right);
      col.append(box);
    } else {
      const chain = el('div', 'chain');
      // ① Vstup
      const mi = el('section', 'mod'); const hi = el('h4'); hi.append(el('span', 'n', '1'), document.createTextNode(t('input')));
      mi.append(hi, prow('Gain', paramModel(hn + '/gain', 'Gain', 145, v => sgn(X.gainDb(v), 1) + ' dB')),
        swBtn(hn + '/phantom', '48 V'), swBtn(c + '/preamp/hpon', t('lowCut')),
        prow(t('freq'), paramModel(c + '/preamp/hpf', t('lowCutFreq'), 101, v => Math.round(X.hpfHz(v)) + ' Hz')));
      // ② Gate
      const mg = el('section', 'mod'); const hg = el('h4'); hg.append(el('span', 'n', '2'), document.createTextNode('Gate'),
        swBtn(c + '/gate/on', 'Gate', t('onW'), t('offW'), on => mg.classList.toggle('offm', !on)));
      mg.append(hg, dynGraph(s, 'gate'),
        prow(t('thr'), paramModel(c + '/gate/thr', t('gateThr'), 161, v => Math.round(X.gateThr(v) * 2) / 2 + ' dB')),
        prow(t('range'), paramModel(c + '/gate/range', t('range'), 58, v => Math.round(X.gateRange(v)) + ' dB')),
        prow(t('attack'), paramModel(c + '/gate/attack', t('attack'), 121, v => Math.round(X.attack(v)) + ' ms')),
        prow(t('release'), paramModel(c + '/gate/release', t('release'), 101, v => Math.round(X.release(v)) + ' ms')));
      // ③ EQ
      const me = el('section', 'mod'); const he = el('h4'); he.append(el('span', 'n', '3'), document.createTextNode('EQ'),
        swBtn(c + '/eq/on', 'EQ', t('onW'), t('offW'), on => me.classList.toggle('offm', !on)));
      me.append(he, eqGraph(s));
      const bs = el('div', 'bandsel'); bs.setAttribute('role', 'group'); bs.setAttribute('aria-label', t('eqBands'));
      const bandBox = el('div');
      const showBand = () => {
        bandBox.innerHTML = ''; const P0 = c + '/eq/' + ST.eqBand + '/';
        const Wsave = W.length;
        bandBox.append(prow(t('freq'), paramModel(P0 + 'f', t('bandFreq', ST.eqBand), 201, v => hz(X.eqHz(v)))),
          prow(t('gainEq'), paramModel(P0 + 'g', t('bandGain', ST.eqBand), 121, v => sgn(X.eqDb(v), 2) + ' dB')),
          prow('Q', paramModel(P0 + 'q', t('bandQ', ST.eqBand), 72, v => X.eqQ(v).toFixed(1))));
        bandBox._painters = W.splice(Wsave);
      };
      [1, 2, 3, 4].forEach(i => { const b = el('button', '', t('band', i)); b.type = 'button'; b.style.setProperty('--bc', BANDC[i - 1]);
        b.onclick = () => { ST.eqBand = i; showBand(); sched(); }; bs.append(b); });
      W.push(() => { bs.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', ST.eqBand === i + 1)); (bandBox._painters || []).forEach(f => f()); });
      showBand();
      me.append(bs, bandBox);
      // ④ Kompresor
      const mc = el('section', 'mod'); const hc = el('h4'); hc.append(el('span', 'n', '4'), document.createTextNode(t('comp')),
        swBtn(c + '/dyn/on', t('comp'), t('onW'), t('offW'), on => mc.classList.toggle('offm', !on)));
      const rs = el('div', 'ratios'); rs.setAttribute('role', 'group'); rs.setAttribute('aria-label', t('ratio'));
      [2, 3, 5, 6, 8, 9].forEach(i => { const b = el('button', '', X.RATIOS[i] + ':1'); b.type = 'button';
        b.onclick = () => act(t('ratio') + ' ' + X.RATIOS[i] + ':1', () => w(c + '/dyn/ratio', i)); rs.append(b);
        W.push(() => { b.setAttribute('aria-pressed', val(c + '/dyn/ratio') === i); b.classList.toggle('pend', pend(c + '/dyn/ratio') && val(c + '/dyn/ratio') === i); }); });
      const gr = el('div', 'grbar'); const gri = el('i'); gr.append(gri); gr.setAttribute('aria-hidden', 'true');
      dotFns.push(() => { gri.style.width = Math.min(100, hub.chGR(s.n) / 20 * 100) + '%'; });
      mc.append(hc, dynGraph(s, 'comp'), rs,
        prow(t('thr'), paramModel(c + '/dyn/thr', t('compThr'), 121, v => Math.round(X.compThr(v) * 2) / 2 + ' dB')),
        prow(t('attack'), paramModel(c + '/dyn/attack', t('attack'), 121, v => Math.round(X.attack(v)) + ' ms')),
        prow(t('release'), paramModel(c + '/dyn/release', t('release'), 101, v => Math.round(X.release(v)) + ' ms')),
        prow('Make-up', paramModel(c + '/dyn/mgain', 'Make-up', 49, v => '+' + X.mgain(v).toFixed(1) + ' dB')),
        el('div', 'note', t('grNote')), gr);
      chain.append(mi, mg, me, mc);
      col.append(chain);
    }
    // Kdo ho slyší + výstup
    const who = el('section', 'card');
    const wh = el('div', 'hcap'); wh.append(el('span', '', t('whoHears')), el('small', '', t('whoHearsSub', s.name))); who.append(wh);
    const grid = el('div', 'who'); grid.style.gridTemplateColumns = '220px repeat(4,minmax(0,1fr))';
    const out = el('div', 'sendc'); out.style.setProperty('--mc', 'var(--krai-sand)');
    const om = faderModel(s.fader, t('houseFader', s.name));
    const ob = el('div', 'btns'); ob.style.gridColumn = '1/-1'; ob.append(muteBtn(s));
    out.append(el('span', 'who-n', t('house')), valText(om, 'v'), hSlider(om, 'var(--krai-sand)'), ob);
    grid.append(out);
    MEMBERS.forEach(b => grid.append(sendCard(s, b)));
    who.append(grid); col.append(who);
    page.append(col);
  }

  // MARK: - Odposlechy
  function whyText(s, b) {
    const r = hub.silenceReason(s.id), a = s.send(b);
    if (r === 'mute') return {cls: 'mute', t: t('whyMute')};
    if (r === 'group') return {cls: 'ind', t: t('whyGroup', t('mg', groupOf(s)))};
    if (known(a) && val(a) === 0) return {cls: 'off', t: t('whyOff')};
    if (r === 'nosignal') return {cls: '', t: t('whyNoSignal')};
    return null;
  }
  let popEl = null;
  function closePop() { if (popEl) { popEl.remove(); popEl = null; } }
  function openWhy(s, b, anchor) {
    closePop();
    const p = el('div', 'pop'); p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', t('whyTitle', s.name, mname(b)));
    const r = whyText(s, b), a = s.send(b);
    p.append(el('h4', '', t('whyTitle', s.name, mname(b))));
    const lines = [];
    lines.push(val(s.on) === 0 ? t('whyL_mute', s.name) : t('whyL_muteOk'));
    const g = groupOf(s); lines.push(g ? t('whyL_group', t('mg', g) + ' ' + hub.groupName(g)) : t('whyL_groupOk'));
    lines.push(known(a) && val(a) === 0 ? t('whyL_off', mname(b)) : t('whyL_send', dbt(lin(val(a)))));
    lines.push(val('/bus/' + b + '/mix/on') === 0 ? t('whyL_busMuted', mname(b)) : t('whyL_busOk'));
    lines.push(t('whyL_pre'));
    lines.forEach(x => p.append(el('p', '', x)));
    const row = el('div', 'row');
    if (r && r.cls === 'mute') row.append(btn('prim', t('fixUnmute', s.name), () => { act(t('unmuteAct') + ' ' + s.name, () => w(s.on, 1)); closePop(); }));
    else if (r && r.cls === 'ind') { const gg = groupOf(s); row.append(btn('prim', t('fixGroup', t('mg', gg)), () => { act(t('mg', gg), () => w('/config/mute/' + gg, 0)); closePop(); })); }
    else if (r && r.cls === 'off') row.append(btn('prim', t('fixSend', mname(b)), () => { act(t('sendOnAct', s.name, mname(b)), () => w(a, sendMem[a] || dbf(-10))); closePop(); }));
    else if (val('/bus/' + b + '/mix/on') === 0) row.append(btn('prim', t('fixBus', mname(b)), () => { act(t('unmuteAct') + ' ' + mname(b), () => w('/bus/' + b + '/mix/on', 1)); closePop(); }));
    const cl = btn('', t('close'), () => { closePop(); anchor.focus(); }); row.append(cl);
    p.append(row); p.addEventListener('keydown', e => { if (e.key === 'Escape') { closePop(); anchor.focus(); } });
    $('page').append(p); popEl = p; (row.querySelector('.prim') || cl).focus();
  }
  function monLane(s, b, i) {
    const lane = el('section', 'lane'); lane.dataset.id = s.id; lane.setAttribute('aria-label', t('sendLabel', s.name, mname(b)));
    const c = chColor(s); if (c) lane.style.setProperty('--cc', c);
    const badge = el('span', 'fbadge'); lane.append(badge);
    lane.append(tile(s, false));
    const why = el('button', 'why'); why.type = 'button'; why.onclick = () => openWhy(s, b, why);
    W.push(() => { const r = whyText(s, b); why.className = 'why ' + (r ? r.cls : ''); why.textContent = r ? r.t : t('whyQ'); });
    lane.append(why);
    const m = faderModel(s.send(b), t('sendLabel', s.name, mname(b)));
    const fw = el('div', 'fw'); fw.append(scale(), vFader(m, mcol(b)), meter(s.meter, s.kind !== 'ch'));
    lane.append(fw, valText(m, 'val', true), hearsBtn(s, b));
    W.push(() => { const inBank = Math.floor(i / BANK) === ST.bank && !!hub.controller(); badge.hidden = !inBank; badge.textContent = 'F' + (i % BANK + 1);
      lane.classList.toggle('dim', !!whyText(s, b)); });
    return lane;
  }
  function buildMonitors(page) {
    const b = ST.mon;
    const col = el('div', 'mixcol');
    const tabs = el('div', 'mtabs'); tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', t('whoseMix'));
    MEMBERS.forEach(x => {
      const tb = el('button', 'mtab'); tb.type = 'button'; tb.id = 'mon-' + x; tb.style.setProperty('--mc', mcol(x));
      const st = el('small');
      tb.append(el('i', 'dot'), el('b', '', mname(x)), st, meter(25 + x));
      tb.lastChild.classList.add('mini');
      tb.setAttribute('aria-pressed', x === b);
      tb.onclick = () => { ST.mon = x; store.set('mon', x); render(); };
      W.push(() => { const ph = hub.phones()[x]; st.textContent = ph ? t('phoneOn') : t('phoneOff'); });
      tabs.append(tb);
    });
    const sc = el('div', 'strips'); sc.id = 'strips'; sc.setAttribute('aria-label', t('monitorOf', mname(b)));
    SL.forEach((s, i) => sc.append(monLane(s, b, i)));
    col.append(tabs, sc);
    // pravý sloupec: odposlech celkem, Pojistka uší, MLUVIT K…, Kontrola
    const side = el('aside', 'side'); side.style.width = '300px';
    const h = el('div', 'hcap'); h.append(el('span', '', t('monTotal', mname(b))), el('small', '', 'AUX ' + b)); side.append(h);
    const fa = '/bus/' + b + '/mix/fader', oa = '/bus/' + b + '/mix/on';
    const fm = faderModel(fa, t('monTotal', mname(b)));
    const r1 = el('div', 'prow'); r1.style.gridTemplateColumns = 'minmax(0,1fr) 70px';
    r1.append(hSlider(fm, mcol(b)), valText(fm, 'v', true)); side.append(r1);
    const two = el('div', 'btns');
    const mb = btn('mute', 'MUTE', () => act((val(oa) === 1 ? t('muteAct') : t('unmuteAct')) + ' ' + t('monitorOf', mname(b)), () => w(oa, val(oa) === 1 ? 0 : 1)));
    W.push(() => { const m = val(oa) === 0; mb.classList.toggle('on', m); mb.setAttribute('aria-pressed', m); mb.textContent = m ? t('mutedBig') : 'MUTE'; mb.setAttribute('aria-label', t('monitorOf', mname(b)) + ' MUTE'); });
    const q6 = btn('warnline', '−6 dB', () => { const d = lin(val(fa)); if (!(isFinite(d) && d > -60)) { toast(t('tooQuiet')); return; }
      act(t('quietOne', mname(b)), () => w(fa, dbf(Math.max(-60, d - 6)))); toast(t('quietOneToast', mname(b)), false, t('undoBtn'), doUndo); });
    q6.setAttribute('aria-label', t('quietOneLabel', mname(b)));
    two.append(mb, q6); side.append(two);
    // Kopírovat od…
    const cp = el('div', 'btns');
    const sel = el('select', 'btn'); sel.setAttribute('aria-label', t('copyFrom'));
    MEMBERS.filter(x => x !== b).forEach(x => { const o = el('option', '', mname(x)); o.value = x; sel.append(o); });
    const cb = armed(btn(''), t('copyFrom'), () => t('copyAgain'), () => {
      const from = +sel.value;
      act(t('copyAct', mname(from), mname(b)), () => { SL.forEach(s => { if (val(s.send(b)) !== val(s.send(from))) w(s.send(b), val(s.send(from))); });
        const d = lin(val(fa)); if (isFinite(d) && d > -60) w(fa, dbf(Math.max(-60, d - 6))); });
      toast(t('copied', mname(from)), false, t('undoBtn'), doUndo);
    });
    cp.append(sel, cb); side.append(cp);
    side.append(btn('wide', t('qrForPhone'), () => { ST.page = 'band'; ST.bandFocus = b; render(); }));
    // Pojistka uší
    const gh = el('div', 'hcap'); gh.append(el('span', '', t('earGuard')), el('small', '', 'limiter')); side.append(gh);
    const da = '/bus/' + b + '/dyn/on', ta = '/bus/' + b + '/dyn/thr';
    const g = el('div', 'guard'); const gs = el('span', 'st'); gs.id = 'guardSt';
    let offArm = 0;
    const gb = btn('sw', '', () => {
      if (val(da) === 1) {
        if (ST.concert) { toast(t('guardConcert')); return; }
        if (!offArm || Date.now() - offArm > 5000) { offArm = Date.now(); gb.classList.add('armed'); gb.textContent = t('guardOffAgain'); say(t('confirm5', t('guardOffAgain'))); setTimeout(() => { offArm = 0; gb.classList.remove('armed'); sched(); }, 5000); return; }
        offArm = 0; gb.classList.remove('armed'); act(t('guardOffAct', mname(b)), () => w(da, 0));
      } else act(t('guardOnAct', mname(b)), () => w(da, 1));
    });
    W.push(() => { const on = val(da) === 1; gs.className = 'st ' + (on ? 'ok' : 'no'); gs.textContent = on ? t('protecting') : t('noGuard');
      if (!gb.classList.contains('armed')) { gb.textContent = on ? t('onW') : t('offW'); } gb.classList.toggle('on', on); gb.setAttribute('aria-pressed', on);
      gb.setAttribute('aria-label', t('earGuard') + ' ' + mname(b)); });
    g.append(gs, gb); side.append(g);
    side.append(prow(t('ceiling'), paramModel(ta, t('ceilingOf', mname(b)), 121, v => Math.round(X.compThr(v)) + ' dB')));
    const grb = el('div', 'grbar'); const gri = el('i'); grb.append(gri); grb.setAttribute('aria-hidden', 'true');
    const grt = el('div', 'note');
    dotFns.push(() => { const v = online() ? hub.GR(b) : 0; gri.style.width = Math.min(100, v / 12 * 100) + '%'; grt.textContent = v > 0.2 ? t('grNow', v.toFixed(1)) : t('grNone'); });
    side.append(grb, grt);
    // MLUVIT K <členovi>
    const th = el('div', 'hcap'); th.append(el('span', '', t('talkToH', mname(b)))); side.append(th);
    const tb = el('button', 'talk'); tb.type = 'button'; tb.id = 'talkMember';
    holdTalk(tb, () => [b], () => t('talkMember', b), () => t('talkMemberLit', b));
    side.append(tb, el('div', 'note', t('talkHint', hub.talkMic())));
    // Kontrola (jen rada)
    const kh = el('div', 'hcap'); kh.append(el('span', '', t('check')), el('small', '', t('checkSub'))); side.append(kh);
    const h1 = el('div', 'hint'), h2 = el('div', 'hint');
    W.push(() => {
      const own = SL.filter(s => s.owner === b);
      const ownDb = Math.max(...own.map(s => lin(val(s.send(b)))).concat(-90)), others = Math.max(...SL.filter(s => s.owner !== b).map(s => lin(val(s.send(b)))));
      const ok1 = !own.length || ownDb >= others - 3;
      h1.className = 'hint' + (ok1 ? '' : ' warn'); h1.innerHTML = ''; h1.append(el('b', '', ok1 ? '✓' : '!'), el('span', '', ok1 ? t('chk1ok', mname(b)) : t('chk1warn', mname(b))));
      const on = val(da) === 1;
      h2.className = 'hint' + (on ? '' : ' warn'); h2.innerHTML = ''; h2.append(el('b', '', on ? '✓' : '!'), el('span', '', on ? t('chk2ok', Math.round(X.compThr(val(ta)))) : t('chk2warn')));
    });
    side.append(h1, h2);
    page.append(col, side);
    stripsNow = sc; buildBanks(sc);
    requestAnimationFrame(() => scrollBank(sc, ST.bank));
  }

  // MARK: - Scény a setlist
  function buildScenes(page) {
    const wrap = el('div', 'scenes');
    const left = el('div', 'col');
    // HRAJE / DALŠÍ
    const nc = el('section', 'card nowcard');
    const nm = el('div'); const now = el('div', 'now'), nx = el('div', 'nx');
    nm.append(el('div', 'k', t('playing')), now, el('div', 'k', t('next')), nx);
    const ctr = el('div', 'row');
    const pv = btn('', '◀', () => hub.cue(Math.max(0, hub.next() - 1))); pv.setAttribute('aria-label', t('prevSong'));
    const nb = btn('', '▶', () => hub.cue(Math.min(hub.setlist().length - 1, hub.next() + 1))); nb.setAttribute('aria-label', t('nextSong'));
    const ld = armed(btn('prim big'), () => t('load'), () => t('loadAgain'), () => loadSong(hub.next())); ld.id = 'loadSong';
    ctr.append(pv, nb, ld); nc.append(nm, ctr);
    W.push(() => { const L = hub.setlist(); now.textContent = L[hub.playing()] ? L[hub.playing()].name : '—'; nx.textContent = L[hub.next()] ? L[hub.next()].name : '—'; });
    // setlist
    const sl = el('section', 'card'); sl.append(el('div', 'hcap', t('setlist')));
    const list = el('div'); list.id = 'setlist'; sl.append(list);
    let sig = '';
    W.push(() => {
      const L = hub.setlist(), s2 = JSON.stringify([L, hub.playing(), hub.next()]);
      if (s2 === sig) return; sig = s2; list.innerHTML = '';
      L.forEach((x, i) => {
        const r = el('div', 'song' + (i === hub.playing() ? ' playing' : '') + (i === hub.next() ? ' next' : ''));
        const n = el('button', 'nm'); n.type = 'button'; n.append(document.createTextNode(x.name), el('small', '', t('sceneN', x.slot) + (x.monitors.length ? ' · ' + t('monSaved', x.monitors.map(mname).join(', ')) : '')));
        n.setAttribute('aria-label', t('cueAs', x.name)); n.onclick = () => hub.cue(i);
        const tag = el('span', 'tag ' + (i === hub.playing() ? 'play' : i === hub.next() ? 'nx' : ''), i === hub.playing() ? t('playing') : i === hub.next() ? t('next') : '');
        const sv = armed(btn(''), t('saveHere'), () => t('saveAgain'), () => { if (hub.saveSong(i)) toast(t('savedSong', x.name)); else offline(); });
        r.append(el('span', 'i', (i + 1) + '.'), n, tag, sv); list.append(r);
      });
    });
    // rozsah a přechod
    const so = el('section', 'card'); so.append(el('div', 'hcap', t('scopeH')));
    const scope = el('div', 'scope');
    [['mix', t('scopeMix'), t('scopeMixSub')], ['groups', t('scopeGroups'), t('scopeGroupsSub')]].forEach(([k, l, sub]) => {
      const b = el('button'); b.type = 'button'; b.append(el('b', '', l), document.createTextNode(sub)); b.id = 'scope-' + k;
      b.onclick = () => { ST.scope[k] = !ST.scope[k]; sched(); }; W.push(() => b.setAttribute('aria-pressed', !!ST.scope[k])); scope.append(b);
    });
    const lk = el('button', 'locked'); lk.type = 'button'; lk.disabled = true; lk.id = 'scope-mon';
    lk.append(el('b', '', '🔒 ' + t('scopeMon')), document.createTextNode(t('scopeMonSub'))); scope.append(lk);
    const trs = el('div', 'seg'); trs.setAttribute('role', 'group'); trs.setAttribute('aria-label', t('transition'));
    [[false, t('instant')], [true, t('smooth')]].forEach(([k, l]) => { const b = el('button', '', l); b.type = 'button'; b.onclick = () => { ST.smooth = k; sched(); };
      W.push(() => b.setAttribute('aria-pressed', ST.smooth === k)); trs.append(b); });
    so.append(scope, el('div', 'hcap', t('transition')), trs, el('p', 'note', t('smoothNote')));
    left.append(nc, sl, so);
    // náhled změn + scény v pultu
    const right = el('div', 'col');
    const pr = el('section', 'card'); const ph = el('div', 'hcap'); const phn = el('small'); ph.append(el('span', '', t('preview')), phn); pr.append(ph);
    const tbl = el('table', 'diff'); tbl.id = 'diff';
    tbl.innerHTML = `<thead><tr><th>${t('thType')}</th><th>${t('thEl')}</th><th class="n">${t('thNow')}</th><th class="n">${t('thAfter')}</th></tr></thead><tbody></tbody>`;
    const tbody = tbl.lastChild; pr.append(tbl);
    const monNote = el('p', 'note', t('monUntouched')); monNote.style.marginTop = '6px'; pr.append(monNote);
    let psig = '';
    W.push(() => {
      const L = hub.setlist(), i = hub.next(), scope = Object.keys(ST.scope).filter(k => ST.scope[k]);
      const rows = hub.songDiff(i, scope);
      const s2 = JSON.stringify([i, scope, rows.map(r => [r.a, r.now, r.after])]); if (s2 === psig) return; psig = s2;
      phn.textContent = L[i] ? t('previewOf', L[i].name, rows.length) : '';
      tbody.innerHTML = '';
      rows.slice(0, 14).forEach(r => { const d = describe(r); const tr = el('tr');
        tr.append(el('td', '', d.type), el('td', '', d.el), el('td', 'n', d.now), el('td', 'n ' + d.cls, d.after)); tbody.append(tr); });
      if (rows.length > 14) { const tr = el('tr'); const td = el('td', 'note', t('andMore', rows.length - 14)); td.colSpan = 4; tr.append(td); tbody.append(tr); }
      if (!rows.length) { const tr = el('tr'); const td = el('td', 'note', t('noChanges')); td.colSpan = 4; tr.append(td); tbody.append(tr); }
    });
    const scs = el('section', 'card'); scs.append(el('div', 'hcap', t('scenesInMixer')));
    hub.scenes().forEach(x => {
      const r = el('div', 'scrow');
      const lb = armed(btn(''), t('loadScene'), () => t('loadAgain'), () => {
        const scope = Object.keys(ST.scope).filter(k => ST.scope[k]);
        const res = hub.loadScene(x.slot, scope); if (!res) { offline(); return; }
        const g = {label: t('loadAct', x.name), b: {}}; res.rows.forEach(y => { g.b[y.a] = y.now; }); if (res.rows.length) undo.push(g);
        toast(t('loaded', x.name, res.rows.filter(y => /fader$/.test(y.a)).length), false, t('undoBtn'), doUndo); sched();
      });
      lb.setAttribute('aria-label', t('loadScene') + ' ' + x.name);
      const add = btn('', t('addToSetlist'), () => { hub.addToSetlist(x.slot); toast(t('added', x.name)); });
      add.setAttribute('aria-label', t('addToSetlist') + ': ' + x.name);
      r.append(el('span', 'i', pad(x.slot)), el('span', '', x.name), add, lb); scs.append(r);
    });
    right.append(pr, scs);
    wrap.append(left, right); page.append(wrap);
  }
  function describe(r) {
    const a = r.a; let type = '', name = '', now = '', after = '', cls = '';
    const s = SL.find(x => a.startsWith(x.id + '/'));
    if (/\/mix\/fader$/.test(a) || /^\/dca\/\d\/fader$/.test(a)) {
      type = t('tFader'); now = dbt(lin(r.now)); after = dbt(lin(r.after)); cls = r.after > r.now ? 'up' : 'dn';
    } else if (/\/on$/.test(a)) { type = 'MUTE'; now = r.now === 0 ? 'MUTE' : t('plays'); after = r.after === 0 ? 'MUTE' : t('plays'); }
    else if (/\/pan$/.test(a)) { type = 'Pan'; const p = v => { const x = Math.round((v - 0.5) * 200); return x === 0 ? 'C' : (x < 0 ? 'L' : 'R') + Math.abs(x); }; now = p(r.now); after = p(r.after); }
    else if (/^\/config\/mute\/\d$/.test(a)) { type = t('muteGroup'); now = r.now ? t('mgOn') : '–'; after = r.after ? t('mgOn') : '–'; }
    if (s) name = s.name; else if (/^\/lr/.test(a)) name = t('house'); else if (/^\/dca\/(\d)/.test(a)) name = 'DCA ' + hub.dcaName(+a.split('/')[2]);
    else if (/^\/config\/mute\/(\d)/.test(a)) name = t('mg', +a.split('/')[3]);
    return {type, el: name, now, after, cls};
  }

  // MARK: - Kapela
  function fakeQR(seed) {
    // ilustrace QR (ne skutečný kód) – v appce vede na stránku člena ve Wi‑Fi kapely
    let h = 2166136261; for (const ch of seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 1000) / 1000; };
    const N = 25; let rects = '';
    const finder = (x, y) => { rects += `<rect x="${x}" y="${y}" width="7" height="7"/><rect x="${x + 1}" y="${y + 1}" width="5" height="5" fill="#fff"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3"/>`; };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const inF = (x < 8 && y < 8) || (x > N - 9 && y < 8) || (x < 8 && y > N - 9); if (inF) continue;
      if (rnd() > 0.52) rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
    }
    finder(0, 0); finder(N - 7, 0); finder(0, N - 7);
    return `<svg viewBox="0 0 ${N} ${N}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
  }
  function buildBand(page) {
    const col = el('div', 'col');
    const grid = el('div', 'grid4');
    MEMBERS.forEach(b => {
      const c = el('section', 'card mcard'); c.style.setProperty('--mc', mcol(b)); c.id = 'member-' + b;
      c.append(el('h3', '', mname(b)), el('div', 'note', t('memberChannels', SL.filter(s => s.owner === b).map(s => s.name).join(', ') || '—') + ' · AUX ' + b));
      const st = el('div', 'chip'); st.prepend(el('i', 'dot')); const stt = el('span'); st.append(stt);
      W.push(() => { const on = !!hub.phones()[b]; st.className = 'chip ' + (on ? 'ok' : ''); stt.textContent = on ? t('phoneOn') : t('phoneOff'); });
      const qr = el('div', 'qr'); qr.innerHTML = fakeQR('mixtet-' + b); qr.setAttribute('role', 'img'); qr.setAttribute('aria-label', t('qrOf', mname(b)));
      c.append(st, qr, el('div', 'note', t('qrNote')), btn('wide', t('openOnPhone', mname(b)), () => {
        try { window.parent.MixtetDemo.setMember(b); toast(t('phoneNow', mname(b))); } catch (e) {} }));
      grid.append(c);
    });
    col.append(grid);
    const row = el('div', 'grid4'); row.style.gridTemplateColumns = 'repeat(2,minmax(0,1fr))';
    const chk = el('section', 'card'); chk.append(el('div', 'hcap', t('beforeGig')));
    const items = el('div');
    W.push(() => {
      items.innerHTML = '';
      const guardsOff = MEMBERS.filter(b => val('/bus/' + b + '/dyn/on') !== 1);
      const phones = Object.keys(hub.phones()).length;
      const add = (ok, txt, fixT, fix) => { const h = el('div', 'hint' + (ok ? '' : ' warn')); h.append(el('b', '', ok ? '✓' : '!'), el('span', '', txt)); items.append(h);
        if (!ok && fix) { const f = btn('', fixT, fix); f.style.marginTop = '4px'; items.append(f); } };
      add(online(), online() ? t('ckConn') : t('ckConnNo'));
      add(!guardsOff.length, guardsOff.length ? t('ckGuardNo', guardsOff.map(mname).join(', ')) : t('ckGuard'), t('fixGuards'),
        () => act(t('fixGuards'), () => guardsOff.forEach(b => w('/bus/' + b + '/dyn/on', 1))));
      add(phones > 0, t('ckPhones', phones, 4));
      add(!!hub.controller(), hub.controller() ? t('ckCtrl', hub.controller()) : t('ckCtrlNo'));
    });
    chk.append(items);
    const hubc = el('section', 'card'); hubc.append(el('div', 'hcap', t('hubH')), el('p', 'note', t('hubP1')), el('p', 'note', t('hubP2')));
    hubc.lastChild.style.marginTop = '8px';
    row.append(chk, hubc); col.append(row);
    page.append(col);
    if (ST.bandFocus) { const f = $('member-' + ST.bandFocus); if (f) f.style.boxShadow = 'inset 0 0 0 2px var(--krai-sand)'; ST.bandFocus = 0; }
  }

  // MARK: - Nastavení
  function frow(label, sub, ctl) { const r = el('div', 'frow'); const l = el('span', '', label); if (sub) l.append(el('small', '', sub)); r.append(l); [].concat(ctl).forEach(c => r.append(c)); return r; }
  function chk(label, v, on) { const l = el('label', 'chk'); const i = el('input'); i.type = 'checkbox'; i.checked = v; i.onchange = () => on(i.checked); l.append(i, document.createTextNode(label)); return l; }
  function buildSettings(page) {
    const g = el('div', 'setgrid');
    const c1 = el('section', 'card'); c1.append(el('div', 'hcap', t('setMixer')));
    const st = el('span', 'chip'); W.push(() => { st.className = 'chip ' + (online() ? 'ok' : 'warn'); st.textContent = online() ? t('connOk') : t('connLost'); });
    c1.append(frow(t('setModel'), t('setModelSub'), st), frow(t('setIp'), t('setIpSub'), el('span', 'chip', '192.168.1.20')),
      frow(t('reread'), t('rereadSub'), btn('', t('reread'), () => { if (!online()) { offline(); return; } toast(t('rereadDone')); })));
    const c2 = el('section', 'card'); c2.append(el('div', 'hcap', t('setApp')));
    const lg = el('div', 'seg'); lg.setAttribute('role', 'group'); lg.setAttribute('aria-label', t('setLang'));
    [['cs', 'Čeština'], ['en', 'English']].forEach(([l, n]) => { const b = el('button', '', n); b.type = 'button'; b.setAttribute('aria-pressed', l === LANG); b.lang = l;
      b.onclick = () => { if (l !== LANG) try { window.parent.location.href = l === 'cs' ? '/demo/cs/' : '/demo/'; } catch (e) {} }; lg.append(b); });
    c2.append(frow(t('setLang'), t('setLangSub'), lg),
      frow(t('setToggle'), t('setToggleSub'), chk(t('onW'), ST.toggleTalk, v => { ST.toggleTalk = v; store.set('toggleTalk', v); sched(); })),
      frow(t('setKeys'), t('setKeysSub'), chk(t('onW'), ST.keys, v => { ST.keys = v; store.set('keys', v); })));
    const c3 = el('section', 'card'); c3.append(el('div', 'hcap', t('setCtrl')));
    const cs = el('span', 'chip'); W.push(() => { cs.textContent = hub.controller() ? t('ctrlChip', hub.controller(), ST.bank + 1) : t('ctrlNone'); });
    c3.append(frow(t('setCtrlNow'), t('setCtrlSub'), cs), frow(t('setCtrlConnect'), t('setCtrlConnectSub'), btn('', t('setCtrlBtn'), () => {
      try { window.parent.document.getElementById('midi').click(); } catch (e) {} })));
    const c4 = el('section', 'card'); c4.append(el('div', 'hcap', t('setPhones')));
    c4.append(frow(t('setServer'), t('setServerSub'), el('span', 'chip ok', t('onW'))), frow(t('setPhoneTalk'), t('setPhoneTalkSub'), el('span', 'chip ok', t('onW'))),
      frow(t('hubH'), t('hubP1'), el('span', 'chip', 'iPad')));
    g.append(c1, c2, c3, c4); page.append(g);
  }

  // MARK: - vykreslení stránky
  function render() {
    closeMenu(); closePop();
    releaseAll(); releasers.length = 0;
    W = []; dotFns = []; stripsNow = null;
    const page = $('page'); page.innerHTML = ''; page.dataset.page = ST.page;
    document.body.classList.toggle('concert', ST.concert);
    ({mixer: buildMixer, channel: buildChannel, monitors: buildMonitors, scenes: buildScenes, band: buildBand, settings: buildSettings})[ST.page](page);
    if (!['mixer', 'monitors'].includes(ST.page)) buildBanks(null);
    paint();
  }

  // MARK: - měřáky mimo překreslovací graf (30 Hz, při výpadku nula a šrafa – zákon 7)
  let lastM = 0;
  function meters(now) {
    if (now - lastM > 33) {
      lastM = now;
      const off = !online(), M = hub.meters();
      document.querySelectorAll('.meter[data-m]').forEach(m => {
        const db = off ? -90 : (M[+m.dataset.m] ?? -90);
        m.firstChild.style.height = (100 - Math.max(0, Math.min(100, (db + 60) / 60 * 100))) + '%';
        m.classList.toggle('stale', off);
      });
      dotFns.forEach(f => f());
    }
    requestAnimationFrame(meters);
  }

  // MARK: - zkratky (vypínatelné, ne v posuvníku / poli / záložce – zákon v10 č. 8)
  document.addEventListener('keydown', e => {
    if (!ST.keys || e.metaKey || e.ctrlKey || e.altKey) return;
    const tg = e.target, role = tg && tg.getAttribute && tg.getAttribute('role');
    if (role === 'slider' || /INPUT|SELECT|TEXTAREA/.test(tg.tagName) || (tg.closest && tg.closest('nav,.seg,[role=tablist]'))) return;
    if (e.key === ' ' && !e.repeat) { e.preventDefault(); act(t('mg', 1) + ' ' + hub.groupName(1), () => w('/config/mute/1', val('/config/mute/1') === 1 ? 0 : 1)); }
    else if ((e.key === 't' || e.key === 'T') && !e.repeat) { if (!online()) { offline(); return; } keyTalk = hub.talk(true, 'ipad', ST.talkTo.length ? ST.talkTo : MEMBERS); sched(); }
  });
  document.addEventListener('keyup', e => { if ((e.key === 't' || e.key === 'T') && keyTalk) { keyTalk = false; hub.talk(false, 'ipad'); sched(); } });

  // MARK: - napojení na hub (a odpojení při zavření rámu)
  const onSelect = e => { if (e.id && byId[e.id]) { ST.sel = e.id; if (ST.page === 'channel' && byId[e.id].kind === 'ch') render(); else sched(); } };
  const onOutage = o => { if (!o.on) toast(t('backOnline')); sched(); };
  const subs = [['change', onChange], ['talk', sched], ['outage', onOutage], ['select', onSelect], ['song', sched], ['scene', sched], ['mc', sched], ['bank', onBank], ['ctrl', sched]];
  subs.forEach(([e, f]) => hub.on(e, f));
  window.addEventListener('pagehide', () => { releaseAll(); subs.forEach(([e, f]) => hub.off && hub.off(e, f)); });
  setInterval(sched, 1000);   // stav mobilů, Kontrola, odpočty

  buildChrome();
  render();
  requestAnimationFrame(meters);
  window.MixtetIpad = {go, setConcert, state: ST};
})();
