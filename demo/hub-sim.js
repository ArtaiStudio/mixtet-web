/* Mixtet demo – simulovaný hub (Mac s Mixtetem) a pult XR18 v prohlížeči.
   Mluví přesně stejnou řečí jako skutečný server v appce (Sources/KRAIMix/WebServer.swift): HTTP /api/… a SSE
   události init, p, g, m, silence, ping, reload, bye, sel. Skutečné stránky member.html a fullmix.html běží
   beze změny v iframech; shim.js v nich přesměruje fetch a EventSource sem. Všechno je jen v paměti, reload = nový pult.

   Zákony appky, které simulace dodržuje:
   – zápis jde do pultu a stránky ho uvidí až po „echu“ pultu (40–80 ms) → číslo je chvilku kurzívou s „…“,
   – bez spojení s pultem se nic nezapíše (403 / offline), po obnově se jen čte – nic se znovu neposílá,
   – mobil smí jen sendy do svého odposlechu a hlasitost / MUTE svého odposlechu (MemberAccess.allowed),
   – iPad Celý mix smí vstupy, sál, DCA a mute skupiny (TabletAccess.allowed). */
(function (root) {
  'use strict';

  // MARK: - zákon faderu a kvantizace (XAirCodec)
  const lin = f => { if (f <= 0) return -Infinity; if (f >= 0.5) return f * 40 - 30; if (f >= 0.25) return f * 80 - 50; if (f >= 0.0625) return f * 160 - 70; return f * 480 - 90; };
  const quant = f => Math.floor(Math.min(1, Math.max(0, f)) * 1023.5) / 1023;
  const dbf = d => { if (d <= -90) return 0; let f; if (d >= -10) f = (d + 30) / 40; else if (d >= -30) f = (d + 50) / 80; else if (d >= -60) f = (d + 70) / 160; else f = (d + 90) / 480; return quant(f); };
  const pad = n => String(n).padStart(2, '0');

  // MARK: - ukázková kapela (stejná jako DemoBand ve SnapshotTests – žádná skutečná jména)
  const BAND = {
    members: {1: 'Adam', 2: 'Tom', 3: 'Dan', 4: 'Filip'},
    channels: {
      cs: ['Kick', 'Snare', 'Bass', 'Zpev Adam', 'Zpev Tom', 'Zpev Dan', 'Keys L', 'Keys R', 'OH L', 'OH R',
        'Kytara Adam', 'Kytara Tom', 'Synth L', 'Synth R', 'Playback L', 'Playback R'],
      en: ['Kick', 'Snare', 'Bass', 'Vox Adam', 'Vox Tom', 'Vox Dan', 'Keys L', 'Keys R', 'OH L', 'OH R',
        'Gtr Adam', 'Gtr Tom', 'Synth L', 'Synth R', 'Playback L', 'Playback R']
    },
    // kanál → odposlech vlastníka (barva kanálu = barva člena); klávesy a playback bez vlastníka
    owners: {1: 4, 2: 4, 3: 3, 4: 1, 5: 2, 6: 3, 9: 4, 10: 4, 11: 1, 12: 2},
    colors: [1, 1, 3, 3, 5, 5, 4, 2, 2, 2, 2, 6, 6, 7, 7, 0],
    linked: [7, 9, 13, 15],
    fx: ['Hall', 'Delay', 'FX 3', 'FX 4'],
    groups: {cs: ['Nástroje', 'Zpěvy', 'Efekty', 'Playback'], en: ['Instruments', 'Vocals', 'Effects', 'Playback']},
    dcas: {cs: ['Bicí', 'Zpěvy', 'DCA 3', 'DCA 4'], en: ['Drums', 'Vocals', 'DCA 3', 'DCA 4']},
    songs: {cs: ['Úvod', 'Noční jízda', 'Pomalá', 'Singl'], en: ['Intro', 'Night Ride', 'Slow One', 'Single']},
    // mute skupiny: 1 Nástroje, 2 Zpěvy, 3 Efekty (FX návraty), 4 Playback (+ USB)
    muteGroup: ch => ([1, 2, 3, 7, 8, 9, 10, 11, 12, 13, 14].includes(ch) ? 1 : 0) | ([4, 5, 6].includes(ch) ? 2 : 0) | ([15, 16].includes(ch) ? 8 : 0),
    dcaGroup: ch => ([1, 2, 9, 10].includes(ch) ? 1 : 0) | ([4, 5, 6].includes(ch) ? 2 : 0)
  };

  // MARK: - pásy (Strip.inputs: 16 kanálů, aux, 4 FX návraty)
  function makeStrips() {
    const out = [];
    for (let n = 1; n <= 16; n++) out.push({kind: 'ch', n, id: '/ch/' + pad(n), prefix: '/ch/' + pad(n), short: String(n), meter: n - 1});
    out.push({kind: 'aux', n: 0, id: '/rtn/aux', prefix: '/rtn/aux', short: 'AUX', meter: 16});
    for (let n = 1; n <= 4; n++) out.push({kind: 'fx', n, id: '/rtn/' + n, prefix: '/rtn/' + n, short: 'FX' + n, meter: 18 + (n - 1) * 2});
    for (const s of out) {
      s.fader = s.prefix + '/mix/fader'; s.on = s.prefix + '/mix/on'; s.pan = s.prefix + '/mix/pan';
      s.send = b => s.prefix + '/mix/' + pad(b) + '/level';
      s.follower = s.kind === 'ch' && s.n % 2 === 0 && BAND.linked.includes(s.n - 1);
      s.lead = s.kind === 'ch' && BAND.linked.includes(s.n);
    }
    return out;
  }

  // Přísné rozpoznání adres (ParamKey) – co je send, fader, MUTE…
  const RX = {
    send: /^(\/ch\/(0[1-9]|1[0-6])|\/rtn\/aux|\/rtn\/[1-4])\/mix\/(0[1-6])\/level$/,
    input: /^(\/ch\/(0[1-9]|1[0-6])|\/rtn\/aux|\/rtn\/[1-4])\/mix\/(fader|on|pan)$/,
    bus: /^\/bus\/([1-6])\/mix\/(fader|on)$/,
    main: /^\/lr\/mix\/(fader|on)$/,
    dca: /^\/dca\/([1-4])\/(fader|on)$/,
    group: /^\/config\/mute\/([1-4])$/
  };
  const isInt = a => /\/on$/.test(a) || RX.group.test(a);

  function memberAllowed(a, b) {
    const m = RX.send.exec(a); if (m) return +m[3] === b;
    const x = RX.bus.exec(a); return !!x && +x[1] === b;
  }
  function tabletAllowed(a) { return RX.input.test(a) || RX.main.test(a) || RX.dca.test(a) || RX.group.test(a); }
  /* Hodnota tak, jak ji pult přijme a vrátí: on/skupiny int, pan po 1 %, sendy 161 kroků, fadery 1024 kroků. */
  function pultValue(a, v) {
    if (isInt(a)) return v >= 0.5 ? 1 : 0;
    if (/\/pan$/.test(a)) return Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
    if (RX.send.test(a)) return Math.round(quant(v) * 160) / 160;
    return quant(v);
  }

  // MARK: - hub
  function create(opts) {
    opts = opts || {};
    const lang = opts.lang === 'cs' ? 'cs' : 'en';
    const rnd = mulberry(opts.seed || 7);
    const strips = makeStrips();
    const byId = Object.fromEntries(strips.map(s => [s.id, s]));
    const S = {};          // stav pultu: adresa → číslo (pult je zdroj pravdy)
    const names = {};      // id pásu → jméno
    const colors = {};
    const clients = new Set();
    const listeners = {};
    const stars = {};      // bus → ★ (null = ještě si nevybral, platí vlastník)
    const presets = {};    // bus → uložený odposlech
    const songSaved = {};
    let connected = true, outageTimer = 0, outageUntil = 0;
    let talk = null;       // {key, bus, restore, last}
    let lastUse = '';
    const hub = {};

    // výchozí stav jako FakeMixer.defaultState + DemoBand
    strips.forEach(s => {
      if (s.kind === 'ch') { names[s.id] = BAND.channels[lang][s.n - 1]; colors[s.id] = BAND.colors[s.n - 1]; }
      else if (s.kind === 'aux') { names[s.id] = 'USB / Aux'; colors[s.id] = 0; }
      else { names[s.id] = BAND.fx[s.n - 1]; colors[s.id] = 2; }
      S[s.fader] = s.kind === 'aux' ? 0.6 : 0.75;
      S[s.on] = 1; S[s.pan] = 0.5;
      for (let b = 1; b <= 6; b++) {
        let v = 0;
        if (s.kind === 'ch' && b <= 4) v = Math.round((0.2 + rnd() * 0.5) * 160) / 160;
        if (s.kind === 'aux') v = 0.5;
        if (s.kind === 'fx' && s.n === 1 && b <= 4) v = Math.round(0.45 * 160) / 160;   // trochu dozvuku v uších
        S[s.send(b)] = v;
      }
      s.muteMask = s.kind === 'ch' ? BAND.muteGroup(s.n) : s.kind === 'fx' ? 4 : 8;
      s.dcaMask = s.kind === 'ch' ? BAND.dcaGroup(s.n) : 0;
    });
    // vlastní kanály mají v odposlechu vlastníka víc (ať je JÁ slyšet)
    for (const [ch, b] of Object.entries(BAND.owners)) S[byId['/ch/' + pad(ch)].send(b)] = Math.round(0.72 * 160) / 160;
    // sudý kanál propojeného páru zrcadlí lichý (pult)
    strips.filter(s => s.follower).forEach(s => { const l = byId['/ch/' + pad(s.n - 1)]; for (let b = 1; b <= 6; b++) S[s.send(b)] = S[l.send(b)]; S[s.fader] = S[l.fader]; });
    for (let b = 1; b <= 6; b++) {
      S['/bus/' + b + '/mix/fader'] = 0.75; S['/bus/' + b + '/mix/on'] = 1;
      // Pojistka uší (recept CLAUDE.md): limiter −6 dB, ratio 100 – jen odposlechy kapely
      S['/bus/' + b + '/dyn/on'] = b <= 4 ? 1 : 0; S['/bus/' + b + '/dyn/thr'] = 0.9;
    }
    S['/lr/mix/fader'] = 0.75; S['/lr/mix/on'] = 1;
    for (let g = 1; g <= 4; g++) { S['/dca/' + g + '/fader'] = 0.75; S['/dca/' + g + '/on'] = 1; S['/config/mute/' + g] = 0; }

    // MARK: - události pro stránku demo (prohlídka, ovladač)
    hub.on = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); };
    function emit(ev, d) { (listeners[ev] || []).forEach(fn => { try { fn(d); } catch (e) { console.error(e); } }); }

    // MARK: - dotazy na stav
    hub.lang = lang;
    hub.connected = () => connected;
    hub.strips = () => strips.filter(s => !s.follower).map(s => ({id: s.id, name: names[s.id], fader: s.fader, on: s.on, kind: s.kind}));
    hub.stripName = id => names[id];
    hub.memberName = b => BAND.members[b] || (lang === 'cs' ? 'Odposlech ' : 'Monitor ') + b;
    hub.members = () => [1, 2, 3, 4].map(b => ({bus: b, name: BAND.members[b]}));
    hub.memberBus = 1;
    hub.memberKey = () => 'demo-m' + hub.memberBus;
    hub.tabletLink = () => 'demotablet01';
    hub.tabletSession = () => 'demo-tablet-session-000001';
    hub.noteUse = role => { lastUse = role; emit('use', role); };
    hub.lastUse = () => lastUse;
    hub.talking = () => !!talk;

    // MARK: - důvod ticha (SilenceChain): přímý MUTE, mute skupina, DCA
    function silence(s) {
      if (S[s.on] === 0) return 'mute';
      for (let g = 1; g <= 4; g++) if ((s.muteMask & (1 << (g - 1))) && S['/config/mute/' + g] === 1) return 'group';
      for (let g = 1; g <= 4; g++) if ((s.dcaMask & (1 << (g - 1))) && S['/dca/' + g + '/on'] === 0) return 'dca';
      return null;
    }
    hub.silenceReason = id => byId[id] ? silence(byId[id]) : null;

    // MARK: - zápis: do pultu, echo za 40–80 ms, pak všem stránkám (zákon 2: do echa „…“)
    const echoAt = {};
    const pend = {};       // odesláno do pultu, čeká na echo (jako Mixer.float: hodnota za prstem)
    function write(a, v, origin) {
      if (!connected) return false;
      const pv = pultValue(a, v);
      // echo za 40–80 ms, ale vždy v pořadí zápisů (pult zpracuje pakety, jak přišly)
      const at = Math.max(Date.now() + 40 + rnd() * 40, (echoAt[a] || 0) + 1);
      echoAt[a] = at;
      pend[a] = pv;
      setTimeout(() => { if (connected) commit(a, pv, origin); }, at - Date.now());   // ve výpadku zápis zmizí – stránka vrátí hodnotu
      return true;
    }
    hub.write = (a, v, origin) => write(a, v, origin || 'system');
    /** Hodnota „za prstem“: čekající zápis, jinak potvrzená z pultu. */
    hub.get = a => (a in pend ? pend[a] : S[a]);
    /** Jen potvrzená hodnota z pultu. */
    hub.known = a => S[a];
    function commit(a, v, origin) {
      const old = S[a];
      if (pend[a] === v) delete pend[a];
      S[a] = v;
      // pult zrcadlí propojený pár (fader, MUTE, sendy; pan ne)
      const m = /^\/ch\/(\d\d)\/(mix\/(fader|on|0[1-6]\/level))$/.exec(a);
      if (m && BAND.linked.includes(+m[1])) S['/ch/' + pad(+m[1] + 1) + '/' + m[2]] = v;
      for (const c of clients) {
        const rel = c.bus === 0 ? tabletAllowed(a) : memberAllowed(a, c.bus);
        if (rel) c.send('p', JSON.stringify({a, v}));
      }
      emit('change', {a, v, old, origin});
      if (old !== v && (/\/on$/.test(a) || RX.group.test(a))) pushSilence();
    }

    // MARK: - MLUVIT KE KAPELE: mikrofon Zpěv Adam (ch 4) na 0 dB do odposlechů 1–4, po puštění zpět
    const TALK_STRIP = byId['/ch/04'];
    function talkSet(on, key, bus) {
      if (!on) { if (talk && talk.key === key) releaseTalk(); return true; }
      if (!connected) return false;
      if (talk && talk.key === key) { talk.last = Date.now(); return true; }
      if (talk) return false;
      const restore = {};
      for (let b = 1; b <= 4; b++) { const a = TALK_STRIP.send(b); restore[a] = S[a]; write(a, dbf(0), 'talk'); }
      talk = {key, bus, restore, last: Date.now()};
      emit('talk', {on: true, bus});
      return true;
    }
    function releaseTalk() {
      if (!talk) return;
      const r = talk.restore; const bus = talk.bus; talk = null;
      for (const a in r) write(a, r[a], 'talk');
      emit('talk', {on: false, bus});
    }
    hub.talk = (on, key) => talkSet(on, key || 'midi', -1);
    // hlídání: bez obnovení z mobilu / iPadu se MLUVIT samo pustí do 2 s (WebServer.talkTimeout); ovladač drží sám
    setInterval(() => { if (talk && talk.bus !== -1 && Date.now() - talk.last > 2000) releaseTalk(); }, 500);

    // MARK: - SSE klienti
    /** Otevře proud událostí pro stránku. `deliver(event, dataString)` volá iframe. */
    hub.openStream = (path, deliver) => {
      const p = path.split('/').filter(Boolean);
      let c = null;
      if (p[0] === 'api' && p[1] === 'm' && p[3] === 'events') {
        const b = busForKey(p[2]); if (!b) return null;
        c = {bus: b, key: p[2]};
      } else if (p[0] === 'api' && p[1] === 'cs' && p[3] === 'events') {
        if (p[2] !== hub.tabletSession()) return null;
        c = {bus: 0, key: 'fullmix-' + p[2]};
      } else return null;
      c.send = (ev, data) => { if (!c.closed) { try { deliver(ev, data); } catch (e) { c.closed = true; clients.delete(c); } } };
      c.close = () => { c.closed = true; clients.delete(c); if (talk && talk.key === c.key) releaseTalk(); };
      clients.add(c);
      setTimeout(() => { c.send('init', JSON.stringify(c.bus === 0 ? fullMixPayload() : memberPayload(c.bus))); }, 5);
      return {close: c.close};
    };
    function busForKey(k) { const m = /^demo-m([1-6])$/.exec(k || ''); return m ? +m[1] : 0; }

    function myChannels(b) {
      if (stars[b]) return stars[b];
      return Object.entries(BAND.owners).filter(([, o]) => o === b).map(([ch]) => '/ch/' + pad(ch));
    }
    function memberPayload(b) {
      const list = [], sends = [];
      for (const s of strips) {
        if (s.follower) continue;
        const o = {id: s.id, name: names[s.id], color: colors[s.id], send: s.send(b), meter: s.meter, short: s.short};
        if (s.kind === 'ch' && BAND.owners[s.n]) o.owner = BAND.owners[s.n];
        if (s.lead) o.pair = true;
        list.push(o); sends.push(s.send(b));
      }
      const values = {};
      for (const a of sends.concat(['/bus/' + b + '/mix/fader', '/bus/' + b + '/mix/on'])) values[a] = S[a];
      const center = {};
      if (presets[b]) for (const a in presets[b]) if (sends.includes(a)) center[a] = presets[b][a];
      return {
        bus: b, busName: hub.memberName(b), connected, strips: list, values,
        master: '/bus/' + b + '/mix/fader', masterOn: '/bus/' + b + '/mix/on', masterMeter: 25 + b,
        stars: myChannels(b), hasSnapshot: !!presets[b], center,
        song: BAND.songs[lang][0], songHas: !!songSaved[b],
        copyFrom: [1, 2, 3, 4, 5, 6].filter(x => x !== b).map(x => ({bus: x, name: BAND.members[x] || 'Odposlech ' + x})),
        talk: true, tablet: false, silence: silenceMap()
      };
    }
    function fullMixPayload() {
      const list = [], values = {};
      for (const s of strips) {
        if (s.follower) continue;
        const o = {id: s.id, name: names[s.id], short: s.short, color: colors[s.id], fader: s.fader, on: s.on, pan: s.pan, meter: s.meter};
        if (s.kind === 'ch' && BAND.owners[s.n]) o.owner = BAND.owners[s.n];
        if (s.lead) o.pair = true;
        list.push(o);
        values[s.fader] = S[s.fader]; values[s.on] = S[s.on]; values[s.pan] = S[s.pan];
      }
      values['/lr/mix/fader'] = S['/lr/mix/fader']; values['/lr/mix/on'] = S['/lr/mix/on'];
      const dcas = [1, 2, 3, 4].map(g => { values['/dca/' + g + '/fader'] = S['/dca/' + g + '/fader']; values['/dca/' + g + '/on'] = S['/dca/' + g + '/on'];
        return {name: BAND.dcas[lang][g - 1], fader: '/dca/' + g + '/fader', on: '/dca/' + g + '/on'}; });
      const groups = [1, 2, 3, 4].map(g => { values['/config/mute/' + g] = S['/config/mute/' + g]; return {g, name: BAND.groups[lang][g - 1], addr: '/config/mute/' + g}; });
      return {role: 'fullmix', selected: selected, connected, hub: 'Mac', strips: list,
        main: {id: '/lr', name: 'Sál', fader: '/lr/mix/fader', on: '/lr/mix/on', meter: 36}, dcas, groups, values};
    }
    let selected = '';
    /** Výběr pásu (tlačítko Select na ovladači) → iPad se posune, má-li zapnuté „Sledovat Mac“. */
    hub.select = id => { selected = id; for (const c of clients) if (c.bus === 0) c.send('sel', JSON.stringify({id})); emit('select', {id}); };
    hub.selected = () => selected;

    // MARK: - HTTP
    /** fetch ze stránky → odpověď {status, json} přes callback (vždy asynchronně, jako síť). */
    hub.request = (method, path, body, done) => {
      let r;
      try { r = route(method, path, body); } catch (e) { console.error(e); r = {status: 500, json: {ok: false}}; }
      setTimeout(() => done(r), 15 + rnd() * 20);
    };
    function parse(body) { try { return JSON.parse(body || '{}') || {}; } catch (e) { return {}; } }
    const ok = (j, s) => ({status: s || 200, json: j || {ok: true}});
    function route(method, path, body) {
      const p = path.split('/').filter(Boolean);
      if (p[0] !== 'api') return ok({ok: false}, 404);
      // párování: klíč mobilu → už spárovaný (session)
      if (p[1] === 'pair' && p.length === 3) {
        const b = busForKey(p[2]);
        return b ? ok({v: 1, state: 'session', bus: b, name: hub.memberName(b)}) : ok({v: 1, state: 'unknown'});
      }
      if (p[1] === 'c' && p[3] === 'claim') {
        if (p[2] !== hub.tabletLink()) return ok({ok: false}, 404);
        const pin = String(parse(body).pin || '');
        return /^\d{6}$/.test(pin) ? ok({ok: true, session: hub.tabletSession()}) : ok({ok: false, left: 2}, 403);
      }
      if (p[1] === 'cs' && p.length === 4) {
        if (p[2] !== hub.tabletSession()) return ok({ok: false}, 404);
        if (method !== 'POST') return ok({ok: false}, 403);
        const o = parse(body);
        if (p[3] === 'set') {
          const n = Number(o.v);
          if (typeof o.a !== 'string' || !tabletAllowed(o.a) || !isFinite(n)) return ok({ok: false}, 403);
          return write(o.a, n, 'tablet') ? ok() : ok({ok: false}, 403);
        }
        if (p[3] === 'talk') { const r = talkSet(!!o.on, 'fullmix-' + p[2], 0); return r ? ok() : ok({ok: false}, 409); }
        return ok({ok: false}, 403);
      }
      if (p[1] === 'm' && p.length === 4) {
        const b = busForKey(p[2]);
        if (!b) return ok({ok: false}, 404);
        const o = parse(body);
        switch (p[3]) {
          case 'set': {
            const n = Number(o.v);
            if (typeof o.a !== 'string' || !memberAllowed(o.a, b) || !isFinite(n)) return ok({ok: false}, 403);
            return write(o.a, n, 'mobile:' + b) ? ok() : ok({ok: false}, 403);
          }
          case 'stars': stars[b] = Array.isArray(o.stars) ? o.stars.map(String).slice(0, 40) : []; return ok();
          case 'talk': return talkSet(!!o.on, p[2], b) ? ok() : ok({ok: false}, 409);
          case 'q': return ok();
          case 'save': {
            if (!connected) return ok({ok: false});
            const snap = {}; strips.forEach(s => { snap[s.send(b)] = S[s.send(b)]; }); snap['/bus/' + b + '/mix/fader'] = S['/bus/' + b + '/mix/fader'];
            presets[b] = snap; return ok();
          }
          case 'restore': {
            if (!connected || !presets[b]) return ok({ok: false});
            for (const a in presets[b]) if (S[a] !== presets[b][a]) write(a, presets[b][a], 'mobile:' + b);
            return ok();
          }
          case 'songsave': if (!connected) return ok({ok: false}); songSaved[b] = true; return ok({ok: true, song: BAND.songs[lang][0]});
          case 'copy': {
            const from = Number(o.from);
            if (!connected || !(from >= 1 && from <= 6) || from === b) return ok({ok: false});
            strips.forEach(s => { if (!s.follower && S[s.send(b)] !== S[s.send(from)]) write(s.send(b), S[s.send(from)], 'mobile:' + b); });
            const f = '/bus/' + b + '/mix/fader', d = lin(S[f]);
            if (isFinite(d) && d > -60) write(f, dbf(Math.max(-60, d - 6)), 'mobile:' + b);
            return ok();
          }
        }
        return ok({ok: false}, 404);
      }
      return ok({ok: false}, 404);
    }

    // MARK: - výpadek pultu: hub ho přestane slyšet, stránky ukážou „pult neodpovídá“, pak se jen znovu čte
    hub.outage = (ms) => {
      if (!connected) return false;
      connected = false; outageUntil = Date.now() + (ms || 5000);
      for (const a in pend) delete pend[a];   // co pult nepotvrdil, neplatí
      broadcast('ping', JSON.stringify({connected: false}));
      pushSilence();
      emit('outage', {on: true, until: outageUntil});
      clearTimeout(outageTimer);
      outageTimer = setTimeout(() => {
        connected = true;
        // zákon 3: po obnově se jen čte – pult je zdroj pravdy, nic se znovu neposílá
        broadcast('ping', JSON.stringify({connected: true}));
        pushSilence();
        emit('outage', {on: false});
      }, ms || 5000);
      return true;
    };
    hub.outageLeft = () => connected ? 0 : Math.max(0, outageUntil - Date.now());
    function broadcast(ev, data) { for (const c of clients) c.send(ev, data); }
    setInterval(() => broadcast('ping', JSON.stringify({connected})), 3000);

    // MARK: - měřáky (simulované): obálky podle nástroje, tempo 112 BPM; po faderu, ztlumené = ticho
    const lvl = new Float64Array(16 + 6).fill(-90);   // vstupy před faderem (0–15 ch, 16 aux, 17–20 FX)
    const shown = new Float64Array(40).fill(-90);
    let GR = [0, 0, 0, 0, 0, 0];
    const t0 = performance.now();
    function inputTarget(i, t) {
      const beat = t * 112 / 60, ph = beat % 1, bar = Math.floor(beat) % 4;
      const phrase = k => Math.sin(t * 0.35 + k * 2.1) > -0.15;                     // zpěvák zrovna zpívá?
      switch (i) {
        case 0: return -40 + 32 * Math.exp(-ph * 7);                                // kopák na každou dobu
        case 1: return (bar % 2 === 1) ? -42 + 32 * Math.exp(-ph * 6) : -46;         // virbl na 2 a 4
        case 2: return -18 + 4 * Math.sin(t * 2.3) - 6 * ((beat * 2) % 1);          // basa v osminách
        case 3: case 4: case 5: return phrase(i) ? -15 + 4 * Math.sin(t * 3.1 + i) + 2 * Math.sin(t * 11 + i) : -62;
        case 6: case 7: return -22 + 3 * Math.sin(t * 0.9 + i);
        case 8: case 9: return -30 + 14 * Math.exp(-ph * 3) + 2 * Math.sin(t * 17 + i);
        case 10: case 11: return -16 + 4 * Math.sin(t * 1.7 + i * 1.3) - 3 * ((beat * 2) % 1);
        case 12: case 13: return -26 + 6 * Math.sin(t * 0.25 + i);
        case 14: case 15: return -20 + 2 * Math.sin(t * 0.6 + i);
        case 16: return -48;                                                          // USB / aux skoro ticho
        case 17: return Math.max(lvl[3], lvl[4], lvl[5]) - 12;                        // Hall z vokálů
        case 18: return Math.max(lvl[3], lvl[4]) - 20;                                // Delay
        default: return -95;                                                          // FX 3–4 bez signálu
      }
    }
    const sum = arr => { let p = 0; for (const d of arr) if (d > -89) p += Math.pow(10, d / 10); return p > 0 ? 10 * Math.log10(p) : -90; };
    function tick() {
      const t = (performance.now() - t0) / 1000;
      for (let i = 0; i < lvl.length; i++) {
        const target = inputTarget(i, t) + (rnd() - 0.5) * 3;
        lvl[i] = target > lvl[i] ? target : lvl[i] + (target - lvl[i]) * 0.35;      // rychlý náběh, pomalejší dozvuk
      }
      const ins = strips.map((s, k) => ({s, d: lvl[k]}));
      const post = {};
      for (const {s, d} of ins) {
        const fd = lin(S[s.fader]);
        post[s.id] = silence(s) ? -90 : (isFinite(fd) ? Math.min(0, d + fd) : -90);
      }
      const m = new Array(40).fill(-90);
      ins.forEach(({s}) => { m[s.meter] = post[s.id]; if (s.kind !== 'ch') m[s.meter + 1] = post[s.id]; });
      for (let b = 1; b <= 6; b++) {
        const parts = [];
        for (const {s, d} of ins) {
          const sd = lin(S[s.send(b)]);
          if (!isFinite(sd) || S[s.on] === 0 || (silence(s) === 'group')) continue;  // MUTE a mute skupina ztlumí i sendy
          parts.push(d + sd);
        }
        const fd = lin(S['/bus/' + b + '/mix/fader']);
        let L = (S['/bus/' + b + '/mix/on'] === 1 && isFinite(fd)) ? sum(parts) + fd - 4 : -90;
        let gr = 0;
        if (S['/bus/' + b + '/dyn/on'] === 1 && L > -90) { const thr = -60 + 60 * S['/bus/' + b + '/dyn/thr']; if (L > thr) { gr = (L - thr) * 0.99; L -= gr; } }
        GR[b - 1] = gr;
        m[25 + b] = Math.min(0, L);
      }
      const main = sum(ins.map(({s}) => post[s.id])) - 9 + lin(S['/lr/mix/fader']);
      m[36] = m[37] = m[38] = m[39] = S['/lr/mix/on'] === 1 && isFinite(main) ? Math.min(0, main) : -90;
      for (let i = 0; i < 40; i++) shown[i] = Math.max(-90, Math.min(0, m[i]));
      if (connected) broadcast('m', JSON.stringify(Array.from(shown, v => Math.round(v))));
    }
    setInterval(tick, 50);
    // stažení Pojistky uší do mobilu člena – jen jeho odposlech, 4× za sekundu
    setInterval(() => { if (!connected) return; for (const c of clients) if (c.bus >= 1 && c.bus <= 6) c.send('g', JSON.stringify({gr: Math.round(GR[c.bus - 1] * 10) / 10})); }, 250);
    hub.meters = () => Array.from(shown);

    // MARK: - proč neslyším (stripId → mute | group | dca | nosignal), jen při změně
    const quietSince = {};
    let lastSil = '{}';
    function silenceMap() {
      if (!connected) return {};
      const out = {}, now = Date.now();
      strips.forEach((s, k) => {
        const r = silence(s);
        if (r) { out[s.id] = r; return; }
        if (lvl[k] < -70) { quietSince[s.id] = quietSince[s.id] || now; if (now - quietSince[s.id] >= 5000) out[s.id] = 'nosignal'; }
        else delete quietSince[s.id];
      });
      return out;
    }
    function pushSilence() { const s = JSON.stringify(silenceMap()); if (s !== lastSil) { lastSil = s; broadcast('silence', s); } }
    setInterval(pushSilence, 1000);

    return hub;
  }

  // malý deterministický generátor (ať je ukázka pokaždé stejná)
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  root.MixtetHub = {create, lin, dbf, quant, pultValue, memberAllowed, tabletAllowed};
})(window);
