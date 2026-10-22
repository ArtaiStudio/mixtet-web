/* Mixtet demo – MIDI ovladač přes Web MIDI (Chrome, Edge). Stejná logika jako appka (Sources/KRAIMixMIDI):
   profil podle jména portu (ProfileMatcher), překlad zpráv na sloty (ControllerProfile.resolve), banky po 8 pásech,
   měkké převzetí faderů (SoftTakeover), LED zpět do ovladače (LEDSync). Zápisy jdou do simulovaného hubu
   s původem „midi“ – uvidí je iPad i mobil.
   Mackie Control (DAW režim – nanoKONTROL Studio přes Bluetooth, X‑Touch, FaderPort…): MCUCodec / MCUSurface
   (PLAN 7.6) – fadery Pitch Bend 14 bit, tlačítka a LED jako noty na kanálu 1, V‑Pot relativně CC 16–23. */
(function (root) {
  'use strict';

  // MARK: - rozpoznání profilu (ProfileMatcher.score bez Device Inquiry)
  const normalize = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '');
  function score(profile, name, manufacturer) {
    const ep = normalize(name);
    const m = profile.match || {};
    if ((m.exclude || []).some(x => normalize(x) && ep.includes(normalize(x)))) return 0;
    const hits = (m.names || []).map(normalize).filter(x => x && ep.includes(x));
    if (!hits.length) return 0;
    let s = 1000 + Math.max(...hits.map(h => h.length));
    if (m.manufacturer && manufacturer && normalize(manufacturer).includes(normalize(m.manufacturer))) s += 1;
    return s;
  }
  /** Nejlepší profil, nebo null (žádný / nejednoznačný – v appce pak učení). */
  function matchProfile(name, profiles, manufacturer) {
    let best = 0, win = [];
    for (const p of profiles) {
      const s = score(p, name, manufacturer);
      if (s > best) { best = s; win = [p]; } else if (s && s === best) win.push(p);
    }
    return win.length === 1 ? win[0] : null;
  }

  // MARK: - překlad zprávy na slot
  function delta(rel, raw) {
    const v = raw & 0x7F;
    switch (rel) {
      case 'signMagnitude': return (v & 0x40) ? -(v & 0x3F) : v;
      case 'twosComplement': return v >= 64 ? v - 128 : v;
      case 'offset64': return v - 64;
      default: if (v === 0 || v === 64) return 0; if (v < 64) return v; return v >= 97 ? v - 128 : -(v - 64);
    }
  }
  function resolve(profile, bytes) {
    if (!bytes || bytes.length < 3 || bytes[0] < 0x80 || bytes[0] >= 0xF0) return null;
    const st = bytes[0] & 0xF0, ch = bytes[0] & 0x0F, d1 = bytes[1] & 0x7F, d2 = bytes[2] & 0x7F;
    let type, number, raw;
    if (st === 0xB0) { type = 'cc'; number = d1; raw = d2; }
    else if (st === 0x90 || st === 0x80) { type = 'note'; number = d1; raw = st === 0x80 ? 0 : d2; }
    else if (st === 0xE0) { type = 'pitchbend'; number = null; raw = d1 | (d2 << 7); }
    else return null;
    const c = profile.controls.find(x => x.msg === type && (x.number ?? null) === number && (x.channel ?? profile.channel) === ch);
    if (!c) return null;
    let value;
    if (c.relative) { const d = delta(c.relative, raw); if (!d) return null; value = {relative: d}; }
    else if (c.kind === 'button') value = {pressed: raw > 0};
    else if (type === 'pitchbend') value = {absolute: Math.min(16383, Math.max(0, raw)) / 16383};
    else value = {absolute: Math.min(127, Math.max(0, raw)) / 127};
    return {slot: c.slot, index: c.index ?? null, value};
  }
  function ledBytes(profile, slot, index, on) {
    const c = profile.controls.find(x => x.slot === slot && (x.index ?? null) === (index ?? null));
    if (!c || !c.led) return null;
    const n = c.led.number ?? c.number; if (n == null) return null;
    const ch = (c.led.channel ?? c.channel ?? profile.channel) & 0x0F;
    const v = on ? c.led.on : c.led.off;
    if (c.led.msg === 'cc') return [0xB0 | ch, n & 0x7F, v & 0x7F];
    if (c.led.msg === 'note') return [0x90 | ch, n & 0x7F, v & 0x7F];
    return null;
  }

  // MARK: - Mackie Control: kodek (port MCUCodec.swift 1:1)
  const MCU = (function () {
    const faderMax = 16383, masterStrip = 8;
    const BASE = {rec: 0, solo: 8, mute: 16, select: 24, vpotPush: 32};
    const touchBase = 104;
    const FIXED = {bankLeft: 46, bankRight: 47, channelLeft: 48, channelRight: 49, flip: 50,
      rewind: 91, forward: 92, stop: 93, play: 94, record: 95};
    const BY_NOTE = Object.fromEntries(Object.entries(FIXED).map(([k, v]) => [v, k]));
    const lcdRowWidth = 56, lcdCellWidth = 7;
    const clamp01 = v => (Number.isNaN(v) ? 0 : Math.min(1, Math.max(0, v)));

    const faderValue = raw => Math.min(Math.max(raw, 0), faderMax) / faderMax;
    const faderRaw = v => Math.round(clamp01(v) * faderMax);
    /** Pitch Bend pro motor faderu `strip` (0–7, 8 = master). */
    function fader(strip, v) {
      if (!(strip >= 0 && strip <= masterStrip)) return null;
      const raw = faderRaw(v);
      return [0xE0 | strip, raw & 0x7F, (raw >> 7) & 0x7F];
    }
    /** Číslo noty tlačítka; tlačítka pásů potřebují strip 0–7. `button` = jméno nebo {other: n}. */
    function note(button, strip) {
      if (button in BASE) return strip >= 0 && strip < 8 ? BASE[button] + strip : null;
      if (button in FIXED) return FIXED[button];
      if (button && typeof button === 'object' && button.other != null) return button.other & 0x7F;
      return null;
    }
    /** Nota → {button, strip}. Dotyk 104–112 není tlačítko (řeší decode). */
    function button(n) {
      n &= 0x7F;
      if (n <= 7) return {button: 'rec', strip: n};
      if (n <= 15) return {button: 'solo', strip: n - 8};
      if (n <= 23) return {button: 'mute', strip: n - 16};
      if (n <= 31) return {button: 'select', strip: n - 24};
      if (n <= 39) return {button: 'vpotPush', strip: n - 32};
      if (BY_NOTE[n]) return {button: BY_NOTE[n], strip: null};
      return {button: 'other', note: n, strip: null};
    }
    /** LED tlačítka: Note On kanál 1, velocity 127 svítí / 1 bliká / 0 nesvítí. */
    function led(btn, strip, state) {
      const n = note(btn, strip); if (n == null) return null;
      return [0x90, n, state === 'on' || state === true ? 127 : state === 'blink' ? 1 : 0];
    }
    /** V‑Pot CC 16–23 (sign-magnitude): 1–63 = +n, 65–127 = −(n−64). */
    const vpotDelta = v => delta('signMagnitude', v);
    function vpotValue(d) { if (!d) return 0; const m = Math.min(Math.abs(d), 63); return d > 0 ? m : 0x40 | m; }

    // LCD: F0 00 00 66 <14 hlavní | 15 extender> 12 <offset> text F7
    const lcdHeader = unit => [0xF0, 0x00, 0x00, 0x66, unit || 0x14, 0x12];
    /** Jen ASCII: čeština bez diakritiky („Zpěv M“ → „Zpev M“), jiné znaky = „?“. */
    function ascii(text) {
      return Array.from(String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, ''))
        .map(c => { const v = c.codePointAt(0); return v >= 0x20 && v <= 0x7E ? v : 0x3F; });
    }
    /** 8 jmen do řádku 56 znaků: na pás 7 znaků, nejvýš 6 písmen + mezera. */
    function lcdCells(names) {
      const row = [];
      for (let i = 0; i < 8; i++) {
        const cell = ascii(i < names.length ? String(names[i]).trim() : '').slice(0, lcdCellWidth - 1);
        while (cell.length < lcdCellWidth) cell.push(0x20);
        row.push(...cell);
      }
      return row;
    }
    const lcdRow = (names, row, unit) => (row === 0 || row === 1 ? [...lcdHeader(unit), row * lcdRowWidth, ...lcdCells(names), 0xF7] : null);
    const lcdDisplay = (top, bottom, unit) => [...lcdHeader(unit), 0, ...lcdCells(top), ...lcdCells(bottom), 0xF7];

    /** Jedna zpráva z ovladače → událost, nebo null (cokoli, co MCU tady nedefinuje, a kroky 0). */
    function decode(bytes) {
      if (!bytes || bytes.length < 3 || bytes[0] < 0x80 || bytes[0] >= 0xF0) return null;
      const st = bytes[0] & 0xF0, ch = bytes[0] & 0x0F, d1 = bytes[1] & 0x7F, d2 = bytes[2] & 0x7F;
      if (st === 0xE0) return ch <= masterStrip ? {type: 'fader', strip: ch, value: faderValue(d1 | (d2 << 7))} : null;
      if (st === 0x90 || st === 0x80) {
        if (ch !== 0) return null;
        const pressed = st === 0x90 && d2 > 0;
        if (d1 >= touchBase && d1 <= touchBase + 8) return {type: 'touch', strip: d1 - touchBase, touched: pressed};
        const b = button(d1);
        return {type: 'button', button: b.button, note: d1, strip: b.strip, pressed};
      }
      if (st === 0xB0) {
        if (ch !== 0) return null;
        const d = vpotDelta(d2);
        if (!d) return null;
        if (d1 >= 16 && d1 <= 23) return {type: 'vpot', strip: d1 - 16, delta: d};
        if (d1 === 60) return {type: 'jog', delta: d};
        return null;
      }
      return null;
    }

    // MCUDetect: jméno vstupu (X‑Touch Mini má vlastní CC profil) a provoz (Pitch Bend na kanálech 1–9)
    const NAMES = ['x-touch', 'x touch', 'faderport', 'icon ', 'platform m', 'qcon', 'uf8', 'mackie', 'mcu'];
    function isMCUName(name) { const n = String(name || '').toLowerCase(); return !n.includes('mini') && NAMES.some(x => n.includes(x)); }
    const looksLikeMCU = bytes => !!bytes && (bytes[0] & 0xF0) === 0xE0 && (bytes[0] & 0x0F) <= masterStrip;
    /** Noty na kanálu 1 v rozsahu MCU (tlačítka pásů, Bank, transport, dotyk) – pro CC profily bez not. */
    function looksLikeMCUNote(bytes) {
      if (!bytes || bytes.length < 3 || bytes[0] !== 0x90 && bytes[0] !== 0x80) return false;
      const n = bytes[1] & 0x7F;
      return n <= 39 || (n >= 46 && n <= 50) || (n >= 91 && n <= 95) || (n >= touchBase && n <= touchBase + 8);
    }

    /** MCUMapping.slot: tlačítko → role (null = role v appce není). FLIP = cycle. */
    function slot(b) {
      return {rec: 'rec', solo: 'solo', mute: 'mute', select: 'select', bankLeft: 'bankLeft', bankRight: 'bankRight',
        flip: 'cycle', rewind: 'rewind', forward: 'forward', stop: 'stop', play: 'play', record: 'record'}[b] || null;
    }
    return {faderMax, masterStrip, touchBase, faderValue, faderRaw, fader, note, button, led, vpotDelta, vpotValue,
      lcdHeader, ascii, lcdCells, lcdRow, lcdDisplay, decode, isMCUName, looksLikeMCU, looksLikeMCUNote, slot};
  })();

  // MARK: - motorové fadery (MotorFollower): dotyk drží motor, vlastní echo se nevrací, pásmo necitlivosti
  function createMotorFollower() {
    const DEADBAND = 24;
    let at = {};
    const touched = new Set();
    return {
      deadband: DEADBAND,
      touch(strip, t) { if (t) touched.add(strip); else touched.delete(strip); },
      moved(strip, v) { at[strip] = MCU.faderRaw(v); },
      follow(strip, v) {
        if (touched.has(strip)) return null;
        const raw = MCU.faderRaw(v);
        if (at[strip] != null && Math.abs(at[strip] - raw) <= DEADBAND) return null;
        at[strip] = raw;
        return MCU.fader(strip, v);
      },
      reset() { at = {}; }
    };
  }

  /** Profil pro Mackie Control bez CC mapy (podle jména portu nebo provozu). Motor a displej jen u známých MCU jmen. */
  function mcuProfile(name, byName) {
    return {id: 'mcu', name: String(name || 'Mackie Control'), banks: 8, motorized: !!byName, lcd: !!byName, protocol: 'mcu', controls: []};
  }
  /** Mluví profil sám Mackie Control? (pole `protocol: "mcu"` nebo `mcu: true` / objekt v JSON profilu) */
  const profileIsMCU = p => !!p && (p.protocol === 'mcu' || p.mcu === true || (p.mcu && typeof p.mcu === 'object'));

  // MARK: - měkké převzetí (SoftTakeover.step)
  const CATCH = 0.03, FOREIGN = 0.02;
  function softTakeover(previous, hardware, current, caught, lastSent, enabled, win) {
    win = win || CATCH;
    if (caught && lastSent != null && Math.abs(current - lastSent) > FOREIGN) caught = false;
    if (enabled && !caught) {
      const crossed = previous != null && (previous - current) * (hardware - current) <= 0;
      if (!(Math.abs(hardware - current) < win || crossed)) return {send: null, caught: false};
      caught = true;
    }
    return {send: hardware, caught};
  }

  // MARK: - engine jednoho ovladače
  /** Krok V‑Potu pro pan: 1 % na cvak (pult pan kvantizuje po 1 %, menší krok by se ztratil). */
  const PAN_STEP = 0.01;
  /**
   * @param o.hub   simulovaný hub (MixtetHubSim)
   * @param o.profile profil ovladače
   * @param o.output  MIDIOutput (nebo null) pro LED
   * @param o.mode    'cc' (výchozí) | 'mcu'
   * @param o.sysex   smí se posílat SysEx (LCD Mackie Control)
   * @param o.on      callback(event) – {type: 'bank'|'offline'|'unsupported'|'mcu'|'pickup', …} pro UI
   */
  function createEngine(o) {
    const hub = o.hub, p = o.profile, out = o.output || null, on = o.on || (() => {});
    const width = Math.max(1, p.banks || 8);
    let mode = o.mode === 'mcu' || profileIsMCU(p) ? 'mcu' : 'cc';
    let bank = 0;
    const hw = {}, lastSent = {}, caught = new Set(), down = new Set();
    let ledSent = {};
    const pickup = !p.motorized;
    const motor = createMotorFollower();
    const lcdOn = !!(p.lcd || (p.mcu && p.mcu.lcd)) && !!o.sysex;
    let lcdSent = '';
    const banks = () => { const s = hub.strips(); const b = []; for (let i = 0; i < s.length; i += width) b.push(s.slice(i, i + width)); return b; };
    const bankStrips = () => { const b = banks(); return b[Math.min(bank, b.length - 1)] || []; };
    function resetPickup() { for (const k in hw) delete hw[k]; for (const k in lastSent) delete lastSent[k]; caught.clear(); }
    function bankInfo() { const s = bankStrips(); return {type: 'bank', bank: bank + 1, count: banks().length, first: s[0] ? s[0].name : '', last: s.length > 1 ? s[s.length - 1].name : ''}; }
    function send(b) { if (!out || !b) return; try { out.send(b); } catch (e) { /* ovladač odpojený / SysEx nepovolen */ } }

    /** Absolutní prvek (fader, knob, master) → adresa s měkkým převzetím, pokud ovladač nemá motory. */
    function absAddr(key, a, v, name, isPan) {
      const r = softTakeover(hw[key], v, hub.get(a), caught.has(key), lastSent[key], pickup);
      hw[key] = v;
      if (r.caught) caught.add(key); else caught.delete(key);
      if (r.send == null) { on({type: 'pickup', name}); return; }
      const q = isPan ? Math.round(r.send * 100) / 100 : root.MixtetHub.quant(r.send);
      lastSent[key] = q;
      if (!hub.write(a, q, 'midi')) on({type: 'offline'});
    }
    function absolute(kind, i, v) {
      const s = bankStrips()[i]; if (!s) return;
      const a = kind === 'knob' ? s.fader.replace(/fader$/, 'pan') : s.fader;
      absAddr(kind + i, a, v, s.name, kind === 'knob');
    }
    function toggle(a) { if (!hub.write(a, hub.get(a) === 1 ? 0 : 1, 'midi')) on({type: 'offline'}); }
    function setBank(n) {
      bank = n; resetPickup(); motor.reset(); on(bankInfo()); updateLEDs(true);
    }
    function button(slot, i) {
      const s = i != null ? bankStrips()[i] : null;
      switch (slot) {
        case 'play': return toggle('/config/mute/1');                  // Play = mute skupina 1 (ADR-013)
        case 'muteGroup': return toggle('/config/mute/' + (i + 1));
        case 'mute': if (s) toggle(s.on); return;
        case 'select': if (s) { hub.select(s.id); updateLEDs(false); } return;
        case 'bankLeft': case 'bankRight':
          return setBank(Math.min(banks().length - 1, Math.max(0, bank + (slot === 'bankLeft' ? -1 : 1))));
        case 'home': return setBank(0);
        default: on({type: 'unsupported', slot});
      }
    }
    /** Tlačítko (stisk / puštění) – společné pro CC i Mackie Control. */
    function press(slot, index, pressed) {
      // MLUVIT KE KAPELE = drž (Rec v transportu / naučené tlačítko talk): stisk i puštění
      if (slot === 'record' || slot === 'talk') { if (!hub.talk(pressed, 'midi') && pressed) on({type: 'offline'}); updateLEDs(false); return; }
      const k = slot + '#' + index;
      if (!pressed) { down.delete(k); return; }
      if (down.has(k)) return;
      down.add(k);
      button(slot, index);
    }

    // MARK: Mackie Control
    function enterMCU() {
      if (mode !== 'mcu') { mode = 'mcu'; ledSent = {}; down.clear(); resetPickup(); motor.reset(); lcdSent = ''; }
      on({type: 'mcu', name: p.name, info: bankInfo()});
      updateLEDs(true);
    }
    function handleMCU(bytes) {
      const ev = MCU.decode(bytes);
      if (!ev) {
        // neznámé CC (mimo V‑Pot 16–23 a kolečko 60) jen do ladicího výpisu
        if ((bytes[0] & 0xF0) === 0xB0) return {slot: '?', index: null, value: {}, label: 'CC ' + (bytes[1] & 0x7F) + ' = ' + (bytes[2] & 0x7F) + ' (MCU)'};
        return null;
      }
      switch (ev.type) {
        case 'touch': motor.touch(ev.strip, ev.touched); return {slot: 'touch', index: ev.strip, value: {pressed: ev.touched}};
        case 'fader': {
          if (p.motorized) motor.moved(ev.strip, ev.value);
          if (ev.strip === MCU.masterStrip) absAddr('master', '/lr/mix/fader', ev.value, hub.lang === 'cs' ? 'Sál' : 'Main');
          else absolute('fader', ev.strip, ev.value);
          return {slot: ev.strip === MCU.masterStrip ? 'master' : 'fader', index: ev.strip === MCU.masterStrip ? null : ev.strip, value: {absolute: ev.value}};
        }
        case 'vpot': {
          const s = bankStrips()[ev.strip];
          if (s) {
            const a = s.fader.replace(/fader$/, 'pan');
            const v = Math.round(Math.min(1, Math.max(0, hub.get(a) + ev.delta * PAN_STEP)) * 100) / 100;
            if (v !== hub.get(a) && !hub.write(a, v, 'midi')) on({type: 'offline'});
          }
          return {slot: 'knob', index: ev.strip, value: {relative: ev.delta}};
        }
        case 'jog': on({type: 'unsupported', slot: 'jog'}); return {slot: 'jog', index: null, value: {relative: ev.delta}};
        case 'button': {
          const slot = MCU.slot(ev.button);
          if (!slot) {
            if (ev.pressed) on({type: 'unsupported', slot: ev.button});
            return {slot: '?', index: ev.strip, value: {pressed: ev.pressed}, label: 'nota ' + ev.note + ' (' + ev.button + ')'};
          }
          press(slot, ev.strip, ev.pressed);
          return {slot, index: ev.strip, value: {pressed: ev.pressed}};
        }
      }
      return null;
    }

    function handle(bytes) {
      if (mode === 'mcu') return handleMCU(bytes);
      const e = resolve(p, bytes);
      if (!e) {
        // DAW režim na ovladači s CC profilem: Pitch Bend (fadery) nebo MCU noty na kanálu 1 → přepnout na Mackie Control
        const noPB = !p.controls.some(c => c.msg === 'pitchbend');
        const noNotes = !p.controls.some(c => c.msg === 'note');
        if ((noPB && MCU.looksLikeMCU(bytes)) || (noNotes && MCU.looksLikeMCUNote(bytes))) { enterMCU(); return handleMCU(bytes); }
        return null;
      }
      const v = e.value;
      if (v.absolute != null) { if (e.slot === 'fader' || e.slot === 'knob') absolute(e.slot, e.index, v.absolute); }
      else if (v.relative != null) on({type: 'unsupported', slot: e.slot});
      else press(e.slot, e.index, v.pressed);
      return e;
    }
    // LED: MUTE svítí, když kanál neslyšet v sále (přímo, skupinou, DCA); Play = mute skupina 1; Rec = MLUVIT
    function wanted() {
      const w = {}, s = bankStrips();
      for (let i = 0; i < width; i++) {
        w['mute#' + i] = ['mute', i, !!(s[i] && hub.silenceReason(s[i].id))];
        w['solo#' + i] = ['solo', i, false];
      }
      w['play#'] = ['play', null, hub.get('/config/mute/1') === 1];
      for (let g = 0; g < 4; g++) w['muteGroup#' + g] = ['muteGroup', g, hub.get('/config/mute/' + (g + 1)) === 1];
      w['record#'] = ['record', null, hub.talking()];
      w['talk#'] = ['talk', null, hub.talking()];
      return w;
    }
    // Mackie Control: MUTE / SOLO / SELECT / REC pásů, Play, Rec (MLUVIT), Stop
    function wantedMCU() {
      const w = {}, s = bankStrips(), sel = hub.selected ? hub.selected() : '';
      for (let i = 0; i < 8; i++) {
        w['mute#' + i] = ['mute', i, !!(s[i] && hub.silenceReason(s[i].id))];
        w['solo#' + i] = ['solo', i, false];
        w['select#' + i] = ['select', i, !!(s[i] && s[i].id === sel)];
        w['rec#' + i] = ['rec', i, false];
      }
      w['play#'] = ['play', null, hub.get('/config/mute/1') === 1];
      w['record#'] = ['record', null, hub.talking()];
      w['stop#'] = ['stop', null, false];
      return w;
    }
    function updateLEDs(force) {
      if (!out) return;
      const mcu = mode === 'mcu';
      const w = mcu ? wantedMCU() : wanted();
      for (const k of Object.keys(w).sort()) {
        const [slot, i, lit] = w[k];
        if (!force && ledSent[k] === lit) continue;
        const b = mcu ? MCU.led(slot, i, lit) : ledBytes(p, slot, i, lit);
        if (!b) continue;
        ledSent[k] = lit;
        send(b);
      }
      if (!mcu) return;
      // motorové fadery jedou za potvrzenou hodnotou pultu (zákon 2), master = sál
      if (p.motorized) {
        if (force) motor.reset();
        const s = bankStrips();
        for (let i = 0; i < 8; i++) {
          const a = s[i] ? s[i].fader : null;
          const v = a != null ? hub.known(a) : null;
          if (v != null) send(motor.follow(i, v));
        }
        const m = hub.known('/lr/mix/fader');
        if (m != null) send(motor.follow(MCU.masterStrip, m));
      }
      // displej: nahoře jména pásů, dole kam fadery míří (sál)
      if (lcdOn) {
        const s = bankStrips();
        const lcd = MCU.lcdDisplay(s.slice(0, 8).map(x => x.name), s.slice(0, 8).map(() => 'Sal'));
        const key = lcd.join(',');
        if (force || key !== lcdSent) { lcdSent = key; send(lcd); }
      }
    }
    const off = [];
    hub.on('change', () => updateLEDs(false));
    hub.on('talk', () => updateLEDs(false));
    hub.on('outage', () => updateLEDs(false));
    hub.on('select', () => updateLEDs(false));
    updateLEDs(true);
    return {handle, updateLEDs, bankInfo, enterMCU, profile: p, get bank() { return bank; }, get mode() { return mode; },
      banks: () => banks().length, off};
  }

  // MARK: - připojení přes Web MIDI
  /**
   * @returns Promise<{unsupported}|{denied}|{access}>; ovladače hlásí přes ui.onDevice(name, profile, engine)
   */
  async function connect(hub, profiles, ui) {
    if (!navigator.requestMIDIAccess) return {unsupported: true};
    let access;
    try { access = await navigator.requestMIDIAccess({sysex: false}); } catch (e) { return {denied: true, error: String(e && e.name || e)}; }
    const attached = new Map();
    const sysex = !!access.sysexEnabled;
    const onEv = name => ev => ui.onEvent && ui.onEvent(ev, name);
    const attach = () => {
      const outs = [];
      access.outputs.forEach(x => outs.push(x));
      access.inputs.forEach(input => {
        if (attached.has(input.id) || input.state === 'disconnected') return;
        const profile = matchProfile(input.name, profiles, input.manufacturer);
        const byName = !profile && MCU.isMCUName(input.name);
        const sameName = outs.find(x => x.name === input.name) || null;
        const output = profile ? (sameName || outs.find(x => matchProfile(x.name, profiles, x.manufacturer) === profile) || null) : sameName;
        let engine = null;
        const make = (p, mode) => createEngine({hub, profile: p, output, mode, sysex, on: onEv(input.name)});
        if (profile) engine = make(profile);
        else if (byName) engine = make(mcuProfile(input.name, true), 'mcu');
        input.onmidimessage = m => {
          const bytes = Array.from(m.data || []);
          // neznámý vstup: první Pitch Bend na kanálech 1–9 = Mackie Control (MCUDetect.looksLikeMCU)
          if (!engine && MCU.looksLikeMCU(bytes)) {
            engine = make(mcuProfile(input.name, false), 'mcu');
            attached.set(input.id, engine);
            ui.onDevice && ui.onDevice(input.name, engine.profile, engine);
            engine.enterMCU();
          }
          const r = engine ? engine.handle(bytes) : null;
          ui.onMessage && ui.onMessage(input.name, bytes, r);
        };
        attached.set(input.id, engine);
        ui.onDevice && ui.onDevice(input.name, engine ? engine.profile : null, engine);
        if (engine && engine.mode === 'mcu') engine.enterMCU();
      });
    };
    attach();
    access.onstatechange = () => attach();
    return {access, count: attached.size};
  }

  root.MixtetMIDI = {normalize, matchProfile, resolve, ledBytes, softTakeover, createEngine, connect,
    MCU, createMotorFollower, mcuProfile, profileIsMCU};
})(window);
