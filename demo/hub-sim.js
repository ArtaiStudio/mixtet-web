/* Mixtet demo – simulovaný hub (Mac s Mixtetem) a pult XR18 v prohlížeči.
   Mluví přesně stejnou řečí jako skutečný server v appce (Sources/KRAIMix/WebServer.swift): HTTP /api/… a SSE
   události init, p, g, m, silence, ping, reload, bye, sel. Skutečné stránky member.html a fullmix.html běží
   beze změny v iframech; shim.js v nich přesměruje fetch a EventSource sem. Všechno je jen v paměti, reload = nový pult.

   Zákony appky, které simulace dodržuje:
   – zápis jde do pultu a stránky ho uvidí až po „echu“ pultu (40–80 ms) → číslo je chvilku kurzívou s „…“,
   – bez spojení s pultem se nic nezapíše (403 / offline), po obnově se jen čte – nic se znovu neposílá,
   – mobil smí jen sendy do svého odposlechu a hlasitost / MUTE svého odposlechu (MemberAccess.allowed),
   – iPad Celý mix smí vstupy, sál, DCA a mute skupiny (TabletAccess.allowed),
   – iPad jako samostatný hub (ADR-022, demo/ipad/) píše přímo s původem „hub“ – smí všechno jako Mac.
   Navíc kvůli iPad hubu: zpracování kanálů (gain, 48 V, low cut, gate, EQ 4 pásma, kompresor), Pojistka uší
   (/bus/N/dyn), sóla, scény v pultu a setlist v paměti hubu (načtení nikdy nemění odposlechy). */
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
    dcaGroup: ch => ([1, 2, 9, 10].includes(ch) ? 1 : 0) | ([4, 5, 6].includes(ch) ? 2 : 0),
    // druh nástroje → výchozí zpracování (jako presety prototypu v10); jen pro ukázku
    kinds: ['drums', 'drums', 'bass', 'vox', 'vox', 'vox', 'keys', 'keys', 'drums', 'drums', 'gtr', 'gtr', 'keys', 'keys', 'pb', 'pb'],
    gain: [28, 24, 18, 32, 30, 31, 6, 6, 26, 26, 14, 16, 4, 4, 0, 0],
    phantom: [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0],
    // scény v pultu (slot, jméno) a setlist: píseň = scéna; prvních 5 jako ve snímku Scén v appce
    scenes: {cs: ['Zvukovka', 'Úvod', 'Noční jízda', 'Pomalá', 'Singl', 'Přídavek'], en: ['Soundcheck', 'Intro', 'Night Ride', 'Slow One', 'Single', 'Encore']},
    // rozdíl scény proti zvukovce (dB na fader kanálu, MUTE, skupiny) – jen hlasitosti, MUTE a pan, nikdy odposlechy
    sceneMix: {
      1: {f: {4: -3, 5: -3, 6: -3, 15: -60}, on: {}, dca: {}},
      2: {f: {}, on: {}, dca: {}},
      3: {f: {1: 1.5, 2: 1, 4: 3, 5: 1.5, 11: 2, 13: 2}, on: {}, dca: {}},
      4: {f: {1: -6, 2: -6, 9: -8, 11: -3, 12: 4, 4: 1}, on: {13: 0}, dca: {1: -4}},
      5: {f: {4: 2.5, 5: 2.5, 6: 2.5, 15: 0}, on: {}, dca: {2: 1.5}},
      6: {f: {1: 2, 2: 2, 9: 2, 4: 3}, on: {}, dca: {}}
    }
  };
  const RATIOS = [1.1, 1.3, 1.5, 2, 2.5, 3, 4, 5, 7, 10, 20, 100];
  const EQ_TYPES = ['LCut', 'LShv', 'PEQ', 'VEQ', 'HShv', 'HCut'];
  // MARK: - převody XR18 (XAirCodec / CLAUDE.md, tabulka protokolu) – normovaná hodnota pultu 0–1 ↔ jednotky
  const X = {
    RATIOS, EQ_TYPES,
    hpfHz: f => 20 * Math.pow(20, f), hpfF: hz => Math.log(hz / 20) / Math.log(20),
    gainDb: f => -12 + 72 * f, gainF: d => (d + 12) / 72,
    eqHz: f => 20 * Math.pow(1000, f), eqF: hz => Math.log(hz / 20) / Math.log(1000),
    eqDb: f => -15 + 30 * f, eqDbF: d => (d + 15) / 30,
    eqQ: f => 10 * Math.pow(0.03, f), eqQF: q => Math.log(q / 10) / Math.log(0.03),
    gateThr: f => -80 + 80 * f, gateThrF: d => (d + 80) / 80,
    gateRange: f => 3 + 57 * f, gateRangeF: d => (d - 3) / 57,
    attack: f => 120 * f, attackF: ms => ms / 120,
    release: f => 5 * Math.pow(800, f), releaseF: ms => Math.log(ms / 5) / Math.log(800),
    compThr: f => -60 + 60 * f, compThrF: d => (d + 60) / 60,
    mgain: f => 24 * f, mgainF: d => d / 24
  };
  const clamp01 = v => Math.min(1, Math.max(0, v));
  const ratioIndex = r => { let b = 0; RATIOS.forEach((x, i) => { if (Math.abs(x - r) < Math.abs(RATIOS[b] - r)) b = i; }); return b; };
  X.ratioIndex = ratioIndex;

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
  /* Zpracování kanálů a busů: typ a počet kroků, jak je pult kvantizuje (tabulka protokolu v CLAUDE.md). */
  const PSPEC = [
    [/\/(preamp\/hpon|eq\/on|gate\/on|dyn\/on|phantom)$|^\/-stat\/solosw\/\d\d$/, 'b'],
    [/\/dyn\/ratio$/, 'i', 11], [/\/eq\/[1-4]\/type$/, 'i', 5],
    [/\/preamp\/hpf$/, 'f', 101], [/\/headamp\/\d\d\/gain$/, 'f', 145],
    [/\/eq\/[1-4]\/f$/, 'f', 201], [/\/eq\/[1-4]\/g$/, 'f', 121], [/\/eq\/[1-4]\/q$/, 'f', 72],
    [/\/gate\/thr$/, 'f', 161], [/\/gate\/range$/, 'f', 58], [/\/(gate|dyn)\/attack$/, 'f', 121],
    [/\/(gate|dyn)\/release$/, 'f', 101], [/\/dyn\/thr$/, 'f', 121], [/\/dyn\/mgain$/, 'f', 49]
  ];
  const spec = a => { for (const s of PSPEC) if (s[0].test(a)) return s; return null; };
  const isInt = a => /\/on$/.test(a) || RX.group.test(a);

  function memberAllowed(a, b) {
    const m = RX.send.exec(a); if (m) return +m[3] === b;
    const x = RX.bus.exec(a); return !!x && +x[1] === b;
  }
  function tabletAllowed(a) { return RX.input.test(a) || RX.main.test(a) || RX.dca.test(a) || RX.group.test(a); }
  /* Hodnota tak, jak ji pult přijme a vrátí: on/skupiny int, pan po 1 %, sendy 161 kroků, fadery 1024 kroků. */
  function pultValue(a, v) {
    const sp = spec(a);
    if (sp) {
      if (sp[1] === 'b') return v >= 0.5 ? 1 : 0;
      if (sp[1] === 'i') return Math.round(Math.min(sp[2], Math.max(0, v)));
      return Math.round(clamp01(v) * (sp[2] - 1)) / (sp[2] - 1);
    }
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
    // zpracování kanálů 1–16 (gain, 48 V, low cut, gate, EQ, kompresor) – výchozí podle druhu nástroje
    const PRE = {
      drums: {hp: 40, gate: [1, -45, 30, 1, 120], eq: [[1, 60, 2, 1.4], [2, 400, 0, 1.4], [2, 2500, 0, 1.2], [4, 6000, 1, 1]], comp: [1, -14, 6, 5, 80, 1.5]},
      bass: {hp: 35, gate: [0, -60, 20, 2, 150], eq: [[1, 80, 2, 1], [2, 250, -2, 1.4], [2, 800, 0, 1], [4, 3000, 1, 1]], comp: [1, -20, 6, 10, 120, 2]},
      vox: {hp: 100, gate: [0, -55, 20, 1, 150], eq: [[1, 100, 0, 1], [2, 300, -1.8, 1.5], [2, 3000, 0.9, 1.2], [4, 8000, 2, 0.8]], comp: [1, -15.6, 5, 8, 140, 3]},
      gtr: {hp: 90, gate: [0, -60, 20, 2, 100], eq: [[1, 120, 0, 1], [2, 400, 0, 1.2], [2, 1500, 0, 1], [4, 5000, 1.5, 0.8]], comp: [0, -12, 3, 15, 150, 0]},
      keys: {hp: 60, gate: [0, -60, 10, 2, 100], eq: [[1, 100, 0, 1], [2, 500, 0, 1], [2, 2000, 0, 1], [4, 6000, 0, 1]], comp: [0, -12, 3, 20, 200, 0]},
      pb: {hp: 30, gate: [0, -60, 10, 2, 100], eq: [[1, 100, 0, 1], [2, 500, 0, 1], [2, 2000, 0, 1], [4, 8000, 0, 1]], comp: [0, -12, 3, 20, 200, 0]}
    };
    for (let n = 1; n <= 16; n++) {
      const c = '/ch/' + pad(n), k = BAND.kinds[n - 1], p = PRE[k];
      const set = (a, v) => { S[a] = pultValue(a, v); };
      set('/headamp/' + pad(n) + '/gain', X.gainF(BAND.gain[n - 1])); set('/headamp/' + pad(n) + '/phantom', BAND.phantom[n - 1]);
      set(c + '/preamp/hpon', k === 'pb' || k === 'keys' ? 0 : 1); set(c + '/preamp/hpf', X.hpfF(p.hp));
      set(c + '/gate/on', n === 9 || n === 10 ? 0 : p.gate[0]); set(c + '/gate/thr', X.gateThrF(p.gate[1])); set(c + '/gate/range', X.gateRangeF(p.gate[2]));
      set(c + '/gate/attack', X.attackF(p.gate[3])); set(c + '/gate/release', X.releaseF(p.gate[4]));
      set(c + '/eq/on', k === 'pb' ? 0 : 1);
      p.eq.forEach(([t, f, g, q], i) => { const e = c + '/eq/' + (i + 1) + '/';
        set(e + 'type', t); set(e + 'f', X.eqF(f)); set(e + 'g', X.eqDbF(g)); set(e + 'q', X.eqQF(q)); });
      set(c + '/dyn/on', p.comp[0]); set(c + '/dyn/thr', X.compThrF(p.comp[1])); set(c + '/dyn/ratio', p.comp[2]);
      set(c + '/dyn/attack', X.attackF(p.comp[3])); set(c + '/dyn/release', X.releaseF(p.comp[4])); set(c + '/dyn/mgain', X.mgainF(p.comp[5]));
      S['/-stat/solosw/' + pad(n)] = 0;
    }
    for (let b = 1; b <= 6; b++) S['/bus/' + b + '/dyn/thr'] = pultValue('/bus/1/dyn/thr', X.compThrF(-6));
    // všechno, co pult drží, je v jeho kvantizaci (jinak by návrat na „původní“ hodnotu nebyl přesný)
    for (const a in S) S[a] = pultValue(a, S[a]);

    // MARK: - události pro stránku demo (prohlídka, ovladač)
    hub.on = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); };
    hub.off = (ev, fn) => { const l = listeners[ev]; if (!l) return; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); };
    function emit(ev, d) { (listeners[ev] || []).forEach(fn => { try { fn(d); } catch (e) { console.error(e); } }); }

    // MARK: - dotazy na stav
    hub.lang = lang;
    hub.connected = () => connected;
    hub.strips = () => strips.filter(s => !s.follower).map(s => ({id: s.id, name: names[s.id], fader: s.fader, on: s.on, pan: s.pan, kind: s.kind,
      n: s.n, short: s.short, meter: s.meter, pair: !!s.lead, owner: s.kind === 'ch' ? (BAND.owners[s.n] || 0) : 0,
      instrument: s.kind === 'ch' ? BAND.kinds[s.n - 1] : s.kind === 'fx' ? 'fx' : 'pb', muteMask: s.muteMask, dcaMask: s.dcaMask,
      send: b => s.send(b), solo: s.kind === 'ch' ? '/-stat/solosw/' + pad(s.n) : null}));
    hub.X = X;
    hub.groupName = g => BAND.groups[lang][g - 1];
    hub.dcaName = g => BAND.dcas[lang][g - 1];
    hub.memberGen = b => BAND.members[b];
    /** Kdo je připojený mobilem (odposlech → počet stránek). */
    hub.phones = () => { const o = {}; for (const c of clients) if (c.bus >= 1) o[c.bus] = (o[c.bus] || 0) + 1; return o; };
    hub.isPending = a => a in pend;
    hub.talkMic = () => names['/ch/04'];
    hub.GR = b => GR[b - 1] || 0;
    hub.chGR = n => chGR[n - 1] || 0;
    hub.inputLevel = n => lvl[n - 1];
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
      const m = /^\/ch\/(\d\d)\/(mix\/(fader|on|0[1-6]\/level)|preamp\/.+|gate\/.+|eq\/.+|dyn\/.+)$/.exec(a);
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
    let talkTargets = [1, 2, 3, 4];     // komu jde MLUVIT KE KAPELE (čipy Komu na iPadu); mobil a ovladač berou tohle
    function talkSet(on, key, bus, targets) {
      if (!on) { if (talk && talk.key === key) releaseTalk(); return true; }
      if (!connected) return false;
      if (talk && talk.key === key) { talk.last = Date.now(); return true; }
      if (talk) return false;
      const to = (targets && targets.length ? targets : talkTargets).filter(b => b >= 1 && b <= 6);
      const restore = {};
      for (const b of to) { const a = TALK_STRIP.send(b); restore[a] = S[a]; write(a, dbf(0), 'talk'); }
      talk = {key, bus, restore, last: Date.now(), targets: to};
      emit('talk', {on: true, bus, key, targets: to});
      return true;
    }
    function releaseTalk() {
      if (!talk) return;
      const r = talk.restore; const bus = talk.bus, key = talk.key; talk = null;
      for (const a in r) write(a, r[a], 'talk');
      emit('talk', {on: false, bus, key});
    }
    hub.talk = (on, key, targets) => talkSet(on, key || 'midi', -1, targets);
    hub.talkTargets = t => { if (Array.isArray(t)) talkTargets = t.slice(); return talkTargets.slice(); };
    hub.talkInfo = () => talk ? {key: talk.key, targets: talk.targets.slice()} : null;
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
        song: setlist[playing].name, songHas: !!setlist[playing].monitors[b],
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
    // MARK: - scény v pultu a setlist (paměť hubu). Píseň = scéna; načtení mění jen hlasitosti, MUTE a pan vstupů,
    // sál, DCA a mute skupiny – sendy do odposlechů a hlasitosti odposlechů nikdy (6.7). Každý člen dostane zpátky
    // jen svůj odposlech, pokud si ho v písni uložil z mobilu („Uložit do písně“, 4.5).
    const MIXKEYS = [];
    strips.filter(s => !s.follower).forEach(s => MIXKEYS.push(s.fader, s.on, s.pan));
    MIXKEYS.push('/lr/mix/fader', '/lr/mix/on');
    const GROUPKEYS = [];
    for (let g = 1; g <= 4; g++) GROUPKEYS.push('/dca/' + g + '/fader', '/dca/' + g + '/on', '/config/mute/' + g);
    const BASE = {}; MIXKEYS.concat(GROUPKEYS).forEach(a => { BASE[a] = S[a]; });
    const scenes = BAND.scenes[lang].map((name, i) => {
      const slot = i + 1, d = BAND.sceneMix[slot] || {}, mix = Object.assign({}, BASE);
      for (const n in (d.f || {})) { const a = '/ch/' + pad(n) + '/mix/fader'; mix[a] = dbf(lin(BASE[a]) + d.f[n]); }
      for (const n in (d.on || {})) mix['/ch/' + pad(n) + '/mix/on'] = d.on[n];
      for (const g in (d.dca || {})) mix['/dca/' + g + '/fader'] = dbf(d.dca[g]);
      return {slot, name, mix, saved: slot <= 2 ? '12. 10.' : '28. 9.'};
    });
    const setlist = [2, 3, 4, 5].map(slot => ({slot, name: scenes[slot - 1].name, mix: Object.assign({}, scenes[slot - 1].mix), monitors: {}}));
    let playing = 0, cued = 1;
    hub.scenes = () => scenes.map(x => ({slot: x.slot, name: x.name, saved: x.saved}));
    hub.setlist = () => setlist.map((x, i) => ({i, slot: x.slot, name: x.name, monitors: Object.keys(x.monitors).map(Number)}));
    hub.playing = () => playing;
    hub.next = () => cued;
    hub.cue = i => { if (i >= 0 && i < setlist.length) { cued = i; emit('song', {playing, next: cued}); } };
    const SCOPE_KEYS = {mix: MIXKEYS, groups: GROUPKEYS};
    function scopeKeys(scope) { let k = []; for (const s of (scope || ['mix', 'groups'])) k = k.concat(SCOPE_KEYS[s] || []); return k; }
    function diffOf(mix, scope) {
      const rows = [];
      for (const a of scopeKeys(scope)) if (a in mix && Math.abs((S[a] ?? 0) - mix[a]) > 1e-6) rows.push({a, now: S[a], after: mix[a]});
      return rows;
    }
    hub.songDiff = (i, scope) => setlist[i] ? diffOf(setlist[i].mix, scope) : [];
    hub.sceneDiff = (slot, scope) => scenes[slot - 1] ? diffOf(scenes[slot - 1].mix, scope) : [];
    hub.scopeKeys = scopeKeys;
    /** Zapíše rozdíl do pultu (původ „scene“). Plynule = fadery po 0,1 s z hubu (pult prolínat neumí). */
    function applyMix(mix, scope, smooth) {
      const rows = diffOf(mix, scope);
      for (const r of rows) {
        if (smooth && /fader$/.test(r.a)) {
          const from = r.now, to = r.after;
          for (let k = 1; k <= 20; k++) setTimeout(() => { if (connected) write(r.a, from + (to - from) * k / 20, 'scene'); }, k * 100);
        } else write(r.a, r.after, 'scene');
      }
      return rows;
    }
    hub.loadSong = (i, scope, smooth) => {
      if (!connected || !setlist[i]) return null;
      const song = setlist[i];
      const rows = applyMix(song.mix, scope, smooth);
      // odposlech, který si člen v téhle písni uložil, dostane zpátky jen on (nic jiného do odposlechů nejde)
      const mon = [];
      for (const b in song.monitors) for (const a in song.monitors[b]) if (S[a] !== song.monitors[b][a]) { mon.push({a, now: S[a]}); write(a, song.monitors[b][a], 'scene'); }
      playing = i; cued = Math.min(setlist.length - 1, i + 1);
      emit('song', {playing, next: cued, loaded: true, rows: rows.length});
      for (const c of clients) if (c.bus >= 1) c.send('reload', '{}');
      return {rows, monitors: mon};
    };
    hub.loadScene = (slot, scope) => {
      if (!connected || !scenes[slot - 1]) return null;
      const rows = applyMix(scenes[slot - 1].mix, scope, false);
      emit('scene', {slot, rows: rows.length});
      return {rows, monitors: []};
    };
    hub.saveSong = i => {
      if (!connected || !setlist[i]) return false;
      MIXKEYS.concat(GROUPKEYS).forEach(a => { setlist[i].mix[a] = S[a]; });
      emit('song', {playing, next: cued, saved: i});
      return true;
    };
    hub.addToSetlist = slot => {
      const sc = scenes[slot - 1]; if (!sc) return -1;
      setlist.push({slot, name: sc.name, mix: Object.assign({}, sc.mix), monitors: {}});
      emit('song', {playing, next: cued});
      return setlist.length - 1;
    };
    // MARK: - MODERUJU (6.5): návraty efektů ztlumené přímo (návrat přesný), automix zpěvů jen naznačený; načtení písně ho vypne
    let mc = null;
    hub.mc = () => !!mc;
    hub.setMc = on => {
      if (!connected) return false;
      if (on && !mc) { mc = {}; strips.filter(x => x.kind === 'fx').forEach(x => { mc[x.on] = S[x.on]; write(x.on, 0, 'hub'); }); }
      else if (!on && mc) { const r = mc; mc = null; for (const a in r) write(a, r[a], 'hub'); }
      emit('mc', {on: !!mc}); return true;
    };
    hub.on('song', e => { if (e.loaded && mc) hub.setMc(false); });
    // MARK: - banka ovladače ↔ iPad (banka jde za ovladačem a naopak)
    let bank = 0, ctrl = '';
    hub.controller = () => ctrl;
    hub.noteController = name => { ctrl = String(name || ''); emit('ctrl', {name: ctrl}); };
    hub.bank = () => bank;
    hub.noteBank = k => { bank = k; emit('bank', {bank: k}); };
    hub.requestBank = k => { emit('bankReq', {bank: k}); if (!listeners.bankReq || !listeners.bankReq.length) hub.noteBank(k); };
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
          case 'songsave': {
            if (!connected) return ok({ok: false});
            const snap = {}; strips.forEach(s => { if (!s.follower) snap[s.send(b)] = S[s.send(b)]; }); snap['/bus/' + b + '/mix/fader'] = S['/bus/' + b + '/mix/fader'];
            setlist[playing].monitors[b] = snap; emit('song', {playing, next: cued});
            return ok({ok: true, song: setlist[playing].name});
          }
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
    const chGR = new Float64Array(16);   // stažení kompresoru kanálů (pro Kanál › Kompresor)
    /** Úroveň kanálu po gate a kompresoru (zjednodušeně – jen aby měřáky a GR odpovídaly nastavení). */
    function processed(s, d) {
      if (s.kind !== 'ch') return d;
      const c = s.prefix, i = s.n - 1;
      if (S[c + '/gate/on'] === 1 && d < X.gateThr(S[c + '/gate/thr'])) d -= X.gateRange(S[c + '/gate/range']);
      let gr = 0;
      if (S[c + '/dyn/on'] === 1) {
        const thr = X.compThr(S[c + '/dyn/thr']), r = RATIOS[S[c + '/dyn/ratio']] || 1;
        if (d > thr) gr = (d - thr) * (1 - 1 / r);
        d = d - gr + X.mgain(S[c + '/dyn/mgain']);
      }
      chGR[i] = chGR[i] + (gr - chGR[i]) * (gr > chGR[i] ? 0.6 : 0.2);
      return d;
    }
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
      const ins = strips.map((s, k) => ({s, d: processed(s, lvl[k])}));
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
