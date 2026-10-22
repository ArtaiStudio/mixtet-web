/* Mixtet demo – stránka ukázky: simulovaný hub, iframy se skutečnými stránkami, prohlídka (3 úkoly), ovladač,
   výpadek pultu, zpětná vazba a počítadlo zájmu (bez cookies a bez ID). */
(function () {
  'use strict';
  var C = window.MIXTET_DEMO || {lang: 'en', t: {}, signup: '/#signup'};
  var T = C.t || {};
  var lang = C.lang === 'cs' ? 'cs' : 'en';
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (s, o) { return String(s || '').replace(/\{(\w+)\}/g, function (_, k) { return o && o[k] != null ? o[k] : ''; }); };
  var loadedAt = Date.now();
  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  // MARK: - hub (musí existovat dřív, než iframy načtou shim)
  var hub = window.MixtetHubSim = window.MixtetHub.create({lang: lang});
  var phone = $('fPhone'), tablet = $('fTablet');
  var memberUrl = function () { return '/demo/member.html?lang=' + lang + '&m=' + hub.memberBus; };
  phone.src = memberUrl();
  tablet.src = '/demo/ipad/?lang=' + lang;   // iPad jako samostatný hub (ADR-022) – celá appka, ne jen Celý mix
  // pro iPad hub v rámečku: „Dát mobil vpravo“ z Kapely
  window.MixtetDemo = {setMember: function (b) { setMember(b); }};

  // MARK: - počítadlo zájmu: jen typ události, žádné ID ani cookies
  function demoEvent(type) {
    try { fetch('/api/demo-event', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({type: type}), keepalive: true}).catch(function () {}); } catch (e) {}
  }
  (function () {
    var seen = false;
    try { seen = sessionStorage.getItem('mixtet-demo-start') === '1'; sessionStorage.setItem('mixtet-demo-start', '1'); } catch (e) {}
    if (!seen) demoEvent('start');
  })();
  document.querySelectorAll('[data-signup]').forEach(function (a) { a.addEventListener('click', function () { demoEvent('signup_click'); }); });

  // jazyk: ruční volba = funkční cookie jako na hlavní stránce (server podle ní přesměruje /demo/ ↔ /demo/cs/)
  document.querySelectorAll('.lang a').forEach(function (a) {
    a.addEventListener('click', function () { document.cookie = 'mixtet-lang=' + a.dataset.lang + '; path=/; max-age=31536000; SameSite=Lax; Secure'; });
  });

  var statusEl = $('status');
  function status(msg) { statusEl.textContent = ''; setTimeout(function () { statusEl.textContent = msg || ''; }, 30); }

  // MARK: - čí je mobil
  var picks = document.querySelectorAll('.pick');
  function setMember(b) {
    hub.memberBus = b;
    picks.forEach(function (p) { p.setAttribute('aria-pressed', String(+p.dataset.bus === b)); });
    $('phoneH').textContent = fmt(T.phoneOf, {name: hub.memberName(b)});
    phone.src = memberUrl();
    paintTour();
  }
  picks.forEach(function (p) { p.addEventListener('click', function () { setMember(+p.dataset.bus); }); });
  $('phoneH').textContent = fmt(T.phoneOf, {name: hub.memberName(1)});

  // MARK: - přepínač zařízení: iPad (výchozí) / Mac vlevo, mobil vpravo; na úzkém displeji jedna záložka = jedno zařízení
  var narrowMQ = window.matchMedia('(max-width:700px)');
  var tabs = [$('tab-tablet'), $('tab-mac'), $('tab-phone')];
  var panes = {'tab-tablet': $('pane-tablet'), 'tab-mac': $('pane-mac'), 'tab-phone': $('pane-phone')};
  var sel = narrowMQ.matches ? 'tab-phone' : 'tab-tablet', lastLeft = 'tab-tablet';
  function shownTabs() { return narrowMQ.matches ? tabs : tabs.slice(0, 2); }
  function applyTabs() {
    var narrow = narrowMQ.matches;
    var vis = !narrow && sel === 'tab-phone' ? lastLeft : sel;
    tabs.forEach(function (t) {
      var on = t.id === vis;
      t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
      panes[t.id].classList.toggle('inactive', t.id === 'tab-phone' ? (narrow && !on) : !on);
    });
    fitIpad();
  }
  function selectTab(tab, focus) {
    sel = tab.id; if (sel !== 'tab-phone') lastLeft = sel;
    applyTabs();
    if (focus) tab.focus();
  }
  tabs.forEach(function (t) {
    t.addEventListener('click', function () { selectTab(t); });
    t.addEventListener('keydown', function (e) {
      var list = shownTabs(), i = list.indexOf(t);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault(); selectTab(list[(i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length], true);
      }
    });
  });
  if (narrowMQ.addEventListener) narrowMQ.addEventListener('change', applyTabs);

  // MARK: - iPad na šířku (1180 × 820) zmenšený na šířku sloupce; na úzkém displeji 1:1 s posunem do strany
  var fit = $('ipadFit'), IPAD_W = 1180;
  function fitIpad() {
    if (narrowMQ.matches) { tablet.style.transform = ''; return; }
    var w = fit.clientWidth; if (!w) return;
    tablet.style.transform = 'scale(' + (w / IPAD_W).toFixed(4) + ')';
  }
  if (window.ResizeObserver) new ResizeObserver(fitIpad).observe(fit); else window.addEventListener('resize', fitIpad);

  // MARK: - Mac appka: snímky (šipky, tečky, klávesy ← →, posun prstem)
  var gal = $('macGallery'), slides = gal ? gal.querySelectorAll('.mslide') : [], dots = document.querySelectorAll('.mdot'), cur = 0;
  function showSlide(i) {
    if (!slides.length) return;
    cur = (i + slides.length) % slides.length;
    slides.forEach(function (sl, k) { sl.hidden = k !== cur; });
    dots.forEach(function (d, k) { d.setAttribute('aria-pressed', String(k === cur)); });
    $('macTitle').textContent = 'Mixtet — ' + slides[cur].dataset.title;
    $('macCount').textContent = fmt(gal.dataset.of, {n: cur + 1, all: slides.length});
  }
  if (gal) {
    $('macPrev').addEventListener('click', function () { showSlide(cur - 1); });
    $('macNext').addEventListener('click', function () { showSlide(cur + 1); });
    dots.forEach(function (d) { d.addEventListener('click', function () { showSlide(+d.dataset.i); }); });
    gal.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); showSlide(cur + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); showSlide(cur - 1); }
    });
    var sx = null;
    gal.addEventListener('pointerdown', function (e) { sx = e.clientX; });
    gal.addEventListener('pointerup', function (e) { if (sx != null && Math.abs(e.clientX - sx) > 40) showSlide(cur + (e.clientX < sx ? 1 : -1)); sx = null; });
    showSlide(0);
  }
  applyTabs();

  // MARK: - výpadek pultu (5 s): stránky ukážou své skutečné stavy, po obnově se nic znovu neposílá
  var outBtn = $('outage'), outLabel = outBtn.textContent, outTimer = 0;
  outBtn.addEventListener('click', function () {
    if (!hub.outage(5000)) return;
    status(T.outageLive);
    outBtn.disabled = true; outBtn.classList.add('warnline');
    var paint = function () { outBtn.textContent = fmt(T.outageRun, {s: Math.ceil(hub.outageLeft() / 1000)}); };
    paint(); clearInterval(outTimer); outTimer = setInterval(paint, 250);
  });
  hub.on('outage', function (o) {
    if (o.on) return;
    clearInterval(outTimer); outBtn.disabled = false; outBtn.classList.remove('warnline'); outBtn.textContent = outLabel;
    status(T.outageBack);
  });

  $('reset').addEventListener('click', function () { store.del('mixtet-demo-tour'); location.reload(); });

  // MARK: - prohlídka: 3 úkoly, hotovo se pozná z událostí hubu
  var TOUR = 'mixtet-demo-tour';
  var tour = store.get(TOUR) || {};
  tour.done = tour.done || {};
  var base = {}; // výchozí sendy do odposlechu Toma (2)
  ['/ch/11/mix/02/level', '/ch/12/mix/02/level', '/ch/04/mix/02/level', '/ch/05/mix/02/level', '/ch/06/mix/02/level'].forEach(function (a) { base[a] = hub.known(a); });
  var aDown = false, aUp = false;
  var KEYS = ['a', 'b', 'c', 'd', 'e'];
  var allDone = function () { return KEYS.every(function (k) { return tour.done[k]; }); };
  function complete(k) {
    if (tour.done[k]) return;
    tour.done[k] = true;
    var n = KEYS.indexOf(k) + 1;
    var all = allDone();
    $('tourLive').textContent = fmt(T.stepDone, {n: n}) + (all ? ' ' + T.allDone + ' ' + T.tourDone : '');
    if (all && !tour.sent) { tour.sent = true; demoEvent('tour_done'); }
    store.set(TOUR, tour);
    paintTour();
  }
  function paintTour() {
    KEYS.forEach(function (k, i) {
      var li = $('step-' + k), d = !!tour.done[k];
      li.classList.toggle('done', d);
      li.querySelector('.mark').textContent = d ? '✓' : String(i + 1);
      li.querySelector('.st-s').textContent = ' – ' + (d ? T.doneMark : T.todoMark);
    });
    var sw = $('toTom'); if (sw) sw.hidden = hub.memberBus === 2 || !!tour.done.a;
    $('tourDone').hidden = !allDone();
  }
  hub.on('change', function (c) {
    if (c.origin === 'mobile:2') {
      if (/^\/ch\/1[12]\/mix\/02\/level$/.test(c.a) && c.v < base[c.a]) aDown = true;
      if (/^\/ch\/0[456]\/mix\/02\/level$/.test(c.a) && c.v > base[c.a]) aUp = true;
      if (aDown && aUp) complete('a');
    }
    if (c.a === '/config/mute/1' && c.v === 1 && c.v !== c.old && (c.origin === 'hub' || c.origin === 'midi')) complete('b');
    // Kanál › Jednoduše: Kick čistší = Čistota nahoru (EQ pásmo 2 ubere)
    if (c.a === '/ch/01/eq/2/g' && c.origin === 'hub' && c.v < kickG2 - 1e-6) complete('d');
  });
  var kickG2 = hub.known('/ch/01/eq/2/g');
  // další píseň načtená z iPadu (Scény nebo Koncert) – odposlechy se nemění
  hub.on('song', function (e) { if (e.loaded) complete('c'); });
  hub.on('talk', function (t) { if (t.on) complete('e'); });
  $('toTom').addEventListener('click', function () { setMember(2); });
  var tt = $('tourToggle'), tb = $('tourBody');
  function paintToggle() { tb.hidden = !!tour.hidden; tt.setAttribute('aria-expanded', String(!tour.hidden)); tt.textContent = tour.hidden ? tt.dataset.show : tt.dataset.hide; }
  tt.addEventListener('click', function () { tour.hidden = !tour.hidden; store.set(TOUR, tour); paintToggle(); });
  paintToggle(); paintTour();

  // MARK: - ovladač (Web MIDI)
  var chip = $('midiChip'), log = $('midiLog'), dbg = $('midiDbg'), lines = [], midiSent = false, lastPickup = 0, ctrlName = '';
  var hex = function (b) { return b.map(function (x) { return ('0' + x.toString(16).toUpperCase()).slice(-2); }).join(' '); };
  function paintChip(name, info) { chip.hidden = false; chip.textContent = fmt(T.midiChip, {name: name, bank: info.bank, first: info.first, last: info.last || info.first}); }
  var profilesP = null;
  function profiles() {
    if (!profilesP) profilesP = fetch('/demo/profiles/index.json').then(function (r) { return r.json(); })
      .then(function (files) { return Promise.all(files.map(function (f) { return fetch('/demo/profiles/' + f).then(function (r) { return r.json(); }); })); });
    return profilesP;
  }
  $('midi').addEventListener('click', function () {
    if (!navigator.requestMIDIAccess) { status(T.midiUnsupported); return; }
    status(T.midiWait);
    profiles().then(function (list) {
      return window.MixtetMIDI.connect(hub, list, {
        onDevice: function (name, profile, engine) {
          if (!profile) { status(fmt(T.midiUnknown, {name: name})); return; }
          ctrlName = profile.name; paintChip(ctrlName, engine.bankInfo()); status(''); hub.noteController(ctrlName);
          if (!midiSent) { midiSent = true; demoEvent('midi_connected'); }
        },
        onEvent: function (ev, name) {
          if (ev.type === 'bank') paintChip(ctrlName, ev);
          else if (ev.type === 'offline') status(T.midiOffline);
          else if (ev.type === 'unsupported') status(T.midiUnsupportedSlot);
          else if (ev.type === 'mcu') { ctrlName = fmt(T.midiMcuName, {name: ev.name}); paintChip(ctrlName, ev.info || {}); status(T.midiMcu); lastPickup = Date.now(); hub.noteController(ctrlName);   // hláška o režimu nepřebije hned pickup
            if (!midiSent) { midiSent = true; demoEvent('midi_connected'); } }
          else if (ev.type === 'pickup' && Date.now() - lastPickup > 2500) { lastPickup = Date.now(); status(fmt(T.midiPickup, {name: ev.name})); }
        },
        onMessage: function (name, bytes, e) {
          dbg.hidden = false;
          lines.unshift(hex(bytes) + (e ? '  → ' + e.slot + (e.index != null ? ' ' + (e.index + 1) : '') + (e.value.absolute != null ? ' = ' + e.value.absolute.toFixed(2) : e.value.relative != null ? ' ' + (e.value.relative > 0 ? '+' : '') + e.value.relative : e.value.pressed != null ? (e.value.pressed ? ' ↓' : ' ↑') : '') + (e.label ? '  ' + e.label : '') : '  → ?') + '  (' + name + ')');
          lines.length = Math.min(lines.length, 8);
          log.textContent = lines.join('\n');
        }
      });
    }).then(function (r) {
      if (!r) return;
      if (r.unsupported) status(T.midiUnsupported);
      else if (r.denied) status(T.midiDenied);
      else if (!r.count) status(T.midiNone);
    }).catch(function () { status(T.midiDenied); });
  });

  // MARK: - zpětná vazba → /api/feedback (kind other, source demo; kontext ukázky do zprávy)
  var dlg = $('fb'), form = $('fbForm');
  function openFb() {
    $('fbErr').hidden = true; $('fbOk').hidden = true;
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    $('fbMsg').focus();
  }
  function closeFb() { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); $('fbOpen').focus(); }
  $('fbOpen').addEventListener('click', openFb);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (en) { $('fbOpen').classList.toggle('mini', en[0].isIntersecting); }, {rootMargin: '-25% 0px -25% 0px'}).observe($('stage'));
  }
  $('fbClose').addEventListener('click', closeFb);
  dlg.addEventListener('click', function (e) { if (e.target === dlg) closeFb(); });
  function context() {
    var step = 'hotovo'; for (var i = KEYS.length - 1; i >= 0; i--) if (!tour.done[KEYS[i]]) step = i + 1;
    return '\n\n— ukázka: úkol=' + step + ', okno=' + innerWidth + '×' + innerHeight + ', naposledy=' + (hub.lastUse() || 'stránka') +
      ', mobil=' + hub.memberName(hub.memberBus) + ', midi=' + (chip.hidden ? 'ne' : 'ano') + ', jazyk=' + lang;
  }
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var msg = $('fbMsg').value.trim(), email = $('fbEmail').value.trim(), err = $('fbErr');
    err.hidden = true;
    if (msg.length < 3) { err.textContent = T.fbShort; err.hidden = false; $('fbMsg').focus(); return; }
    if (email && !/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/.test(email)) { err.textContent = T.fbEmailErr; err.hidden = false; $('fbEmail').focus(); return; }
    var btn = $('fbSend'), label = btn.textContent;
    btn.disabled = true; btn.textContent = T.fbSending;
    fetch('/api/feedback', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({
      message: msg + context(), email: email, kind: 'other', source: 'demo', lang: lang,
      web: form.querySelector('[name=web]').value, t: loadedAt
    })}).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok) { $('fbOk').textContent = T.fbOk; $('fbOk').hidden = false; $('fbMsg').value = ''; }
      else { err.textContent = T.fbErr; err.hidden = false; }
    }).catch(function () { err.textContent = T.fbErr; err.hidden = false; })
      .then(function () { btn.disabled = false; btn.textContent = label; });
  });
})();
