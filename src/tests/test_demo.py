#!/usr/bin/env python3
"""E2E test ukázky /demo/ (Playwright, Chromium). Spouští se proti src/tests/serve.mjs:
    bash src/dist.sh && node src/tests/serve.mjs 8788 dist &
    PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers python3 src/tests/test_demo.py [http://127.0.0.1:8788] [složka-na-snímky]
Kontroluje: bez chyb v konzoli, iPad Celý mix v2 (pásy, mute skupiny 2×2, DCA, Sál, banky, SK1 oranžově), přepínač iPad / Mac / mobil a snímky Mac appky, iPad ↔ mobil, čekající hodnota (kurzíva „…“) a potvrzení, mute skupina 1, MLUVIT
KE KAPELE, výpadek pultu a obnova, prohlídka, 375 px záložky, Safari bez Web MIDI, mapa ovladače s falešným MIDIAccess
(CC profil i Mackie Control: kodek, MotorFollower, auto-detekce z Pitch Bend, fader, MUTE + LED, banka, Play, Rec),
zpětná vazba a počítadlo zájmu."""
import base64, os, sys, time, urllib.request
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8788"
SHOTS = sys.argv[2] if len(sys.argv) > 2 else "/tmp/demo-shots"
os.makedirs(SHOTS, exist_ok=True)
results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail and not cond else ""))


def wait_for(fn, timeout=4.0, step=0.05):
    end = time.time() + timeout
    while time.time() < end:
        try:
            v = fn()
            if v:
                return v
        except Exception:
            pass
        time.sleep(step)
    try:
        return fn()
    except Exception:
        return False


def admin():
    req = urllib.request.Request(BASE + "/admin", headers={"Authorization": "Basic " + base64.b64encode(b"x:test").decode()})
    return urllib.request.urlopen(req).read().decode()


FAKE_MIDI = """
(() => {
  const sent = []; window.__midiOut = sent;
  let input = null;
  const mkPort = (id, name, type) => ({id, name, manufacturer: 'KORG INC.', type, state: 'connected', connection: 'open', onmidimessage: null});
  const inp = mkPort('in1', 'nanoKONTROL Studio', 'input');
  const out = Object.assign(mkPort('out1', 'nanoKONTROL Studio', 'output'), {send: b => sent.push(Array.from(b))});
  const access = {inputs: new Map([['in1', inp]]), outputs: new Map([['out1', out]]), onstatechange: null, sysexEnabled: false};
  window.__midiIn = bytes => inp.onmidimessage && inp.onmidimessage({data: new Uint8Array(bytes)});
  Object.defineProperty(Navigator.prototype, 'requestMIDIAccess', {configurable: true, value: () => Promise.resolve(access)});
})();
"""


FAKE_MIDI_PORTS = """
(() => {
  const names = %s, sent = {}; window.__midiOutBy = sent; window.__midiInBy = {};
  const mkPort = (id, name, type) => ({id, name, manufacturer: 'KORG INC.', type, state: 'connected', connection: 'open', onmidimessage: null});
  const ins = new Map(), outs = new Map();
  names.forEach((n, i) => {
    const inp = mkPort('in' + i, n, 'input'); ins.set(inp.id, inp);
    sent[n] = []; outs.set('out' + i, Object.assign(mkPort('out' + i, n, 'output'), {send: b => sent[n].push(Array.from(b))}));
    window.__midiInBy[n] = bytes => inp.onmidimessage && inp.onmidimessage({data: new Uint8Array(bytes)});
  });
  const access = {inputs: ins, outputs: outs, onstatechange: null, sysexEnabled: false};
  Object.defineProperty(Navigator.prototype, 'requestMIDIAccess', {configurable: true, value: () => Promise.resolve(access)});
})();
"""


def pb(strip, v):
    raw = round(max(0, min(1, v)) * 16383)
    return f"[{0xE0 | strip}, {raw & 0x7F}, {(raw >> 7) & 0x7F}]"


def frames(pg):
    tab = next(f for f in pg.frames if "/demo/ipad/" in f.url)
    ph = next(f for f in pg.frames if "member.html" in f.url)
    return tab, ph


def ready(pg):
    wait_for(lambda: len([f for f in pg.frames if "member.html" in f.url or "/demo/ipad/" in f.url]) == 2)
    tab, ph = frames(pg)
    wait_for(lambda: tab.locator("#page .lane").count() > 10 and ph.locator("#s-me").count() == 1, 6)
    return frames(pg)


def ipad_sizes(frame):
    """[počet textů pod 11 px, počet viditelných ovládacích prvků nižších než 44 px] na iPadu."""
    return frame.evaluate("""() => [[...document.querySelectorAll('body *')].filter(e => e.offsetParent && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
        .map(e => parseFloat(getComputedStyle(e).fontSize)).filter(x => x < 11).length,
      [...document.querySelectorAll('button, [role=slider], select')].filter(e => e.offsetParent && !e.closest('.chips') && getComputedStyle(e).visibility !== 'hidden')
        .map(e => e.getBoundingClientRect()).filter(r => r.height > 0 && r.height < 43.5).length]""")

TXT = {
    "cs": {"sounds": "Zní Kick dobře?", "clar": "3 / 10", "off": "VYPNUTO", "hears": "SLYŠÍ", "prot": "CHRÁNÍ", "noguard": "BEZ POJISTKY",
           "whyMute": "MUTE v mixu", "monUnchanged": "odposlechy beze změny", "loadAgain": "Ještě jednou: načíst", "phoneTom": "Tom",
           "talkTom": "MLUVÍŠ K TOMOVI", "nav": ["Mixer", "Kanál", "Odposlechy", "Scény", "Kapela", "Nastavení"]},
    "en": {"sounds": "Does Kick sound right?", "clar": "3 / 10", "off": "OFF", "hears": "HEARS", "prot": "PROTECTING", "noguard": "NO GUARD",
           "whyMute": "MUTE in the mix", "monUnchanged": "monitors unchanged", "loadAgain": "Tap again: load", "phoneTom": "Tom",
           "talkTom": "TALKING TO TOM", "nav": ["Mixer", "Channel", "Monitors", "Scenes", "Band", "Settings"]},
}
CZ_CHARS = r"[ěščřžýáíéůúňťďĚŠČŘŽÝÁÍÉŮÚŇŤĎ]"
CZ_WORDS = ["Banka", "Sál", "odposlech", "MLUVIT", "pult", "Zpev", "Kytara", "Nástroje", "Zpěvy", "Bicí", "Uložit", "Načíst", "Kanál", "Zkouška"]


def ipad_screens(pg, tab, ph, L):
    """Každá stránka iPad hubu se vykreslí a jde ovládat; změny jdou do simulovaného pultu (a zpátky na mobil)."""
    T = TXT[L]
    H = lambda js: pg.evaluate("MixtetHubSim." + js)
    hubv = lambda a: pg.evaluate(f"MixtetHubSim.known('{a}')")
    check(f"{L}: navigace iPadu", [tab.locator("#nav button").nth(i).inner_text() for i in range(6)] == T["nav"])
    # ---- Kanál › Jednoduše: Čistota zapisuje skutečný EQ (pásmo 2 dolů, 3 nahoru), číslo čeká kurzívou
    tab.locator("#nav-channel").click()
    check(f"{L}: Kanál – Jednoduše", wait_for(lambda: tab.locator("#simpleCard").is_visible()) and T["sounds"] in tab.locator("#simpleCard h3").inner_text(),
          tab.locator("#page").inner_text()[:200])
    check(f"{L}: Kanál – nic pod 11 px, cíle ≥ 44 px", ipad_sizes(tab) == [0, 0], ipad_sizes(tab))
    g2, g3 = hubv("/ch/01/eq/2/g"), hubv("/ch/01/eq/3/g")
    pend_probe(tab)
    tab.locator("#clarityRow .hs").focus()
    for _ in range(3):
        pg.keyboard.press("ArrowRight")
    check(f"{L}: Čistota – číslo čeká na pult (kurzíva …)", wait_for(lambda: tab.evaluate("window.__pend") > 0, 1))
    check(f"{L}: Čistota 3/10 → EQ pásmo 2 −1,8 dB, pásmo 3 +0,9 dB v pultu",
          wait_for(lambda: tab.locator("#clarityRow .v").inner_text() == T["clar"] and hubv("/ch/01/eq/2/g") < g2 and hubv("/ch/01/eq/3/g") > g3
                   and abs(pg.evaluate("MixtetHubSim.X.eqDb(MixtetHubSim.known('/ch/01/eq/2/g'))") + 1.75) < 0.2), [tab.locator("#clarityRow .v").inner_text(), hubv("/ch/01/eq/2/g")])
    # ---- Celý řetězec: gate, EQ, kompresor
    tab.locator("#view-full").click()
    check(f"{L}: Celý řetězec – 4 moduly a graf EQ", wait_for(lambda: tab.locator(".chain .mod").count() == 4) and tab.locator(".chain svg.gfx").count() == 3)
    gate = hubv("/ch/01/gate/on")
    tab.locator(".chain .mod").nth(1).locator("h4 .btn").click()
    check(f"{L}: Gate zap/vyp → pult", wait_for(lambda: hubv("/ch/01/gate/on") == 1 - gate))
    tab.locator(".chain .mod").nth(1).locator("h4 .btn").click()
    tab.locator(".ratios button", has_text="2:1").first.click()
    check(f"{L}: Kompresor poměr 2:1 → pult (index 3)", wait_for(lambda: hubv("/ch/01/dyn/ratio") == 3))
    tab.locator(".bandsel button").nth(2).click()
    b3 = hubv("/ch/01/eq/3/g")
    tab.locator(".chain .mod").nth(2).locator(".prow .hs").nth(1).focus()
    pg.keyboard.press("ArrowRight")
    check(f"{L}: EQ pásmo 3 zisk +0,25 dB → pult", wait_for(lambda: abs(hubv("/ch/01/eq/3/g") - b3 - 1 / 120) < 1e-6), [b3, hubv("/ch/01/eq/3/g")])
    check(f"{L}: Celý řetězec – nic pod 11 px, cíle ≥ 44 px", ipad_sizes(tab) == [0, 0], ipad_sizes(tab))
    # Kdo ho slyší: VYPNUTO u Toma = send 0 (XR18 vypínač sendu nemá), znovu = zpátky
    tom = tab.locator(".who .sendc").nth(2).locator(".btn.mute")
    before = hubv("/ch/01/mix/02/level")
    tom.click()
    check(f"{L}: Kdo ho slyší – {T['off']} = send 0", wait_for(lambda: hubv("/ch/01/mix/02/level") == 0 and tom.inner_text() == T["off"]))
    tom.click()
    check(f"{L}: Kdo ho slyší – {T['hears']} vrátí send", wait_for(lambda: abs(hubv("/ch/01/mix/02/level") - before) < 1e-6 and tom.inner_text() == T["hears"]))
    # ---- Odposlechy
    tab.locator("#nav-monitors").click()
    check(f"{L}: Odposlechy – 4 členové, 17 pásů", wait_for(lambda: tab.locator(".mtab").count() == 4 and tab.locator("#strips .lane").count() == 17))
    check(f"{L}: Odposlechy – nic pod 11 px, cíle ≥ 44 px", ipad_sizes(tab) == [0, 0], ipad_sizes(tab))
    tab.locator("#mon-1").click()
    wait_for(lambda: tab.locator("#mon-1").get_attribute("aria-pressed") == "true")
    # mobil (Adam) → iPad: Hlasitost odposlechu
    side = tab.locator(".side .prow .v").first
    was = side.inner_text()
    ph.locator("#s-me").focus(); pg.keyboard.press("ArrowUp")
    check(f"{L}: mobil → iPad Odposlechy: Adam celkem se změnil", wait_for(lambda: side.inner_text() != was and "…" not in side.inner_text(), 3), [was, side.inner_text()])
    # iPad → mobil: send Kick do odposlechu Adama
    k = tab.locator('#strips .lane[data-id="/ch/01"]')
    s0 = hubv("/ch/01/mix/01/level")
    k.locator(".fader").focus(); pg.keyboard.press("ArrowUp")
    check(f"{L}: iPad Odposlechy → pult (send Kick → Adam +1 dB)", wait_for(lambda: hubv("/ch/01/mix/01/level") > s0))
    # Pojistka uší: vypnutí dvojím stiskem
    gst = tab.locator("#guardSt")
    check(f"{L}: Pojistka uší {T['prot']}", gst.inner_text() == T["prot"], gst.inner_text())
    gb = tab.locator(".guard .btn")
    gb.click(); gb.click()
    check(f"{L}: Pojistka uší – dvojí stisk vypne ({T['noguard']})", wait_for(lambda: hubv("/bus/1/dyn/on") == 0 and gst.inner_text() == T["noguard"]))
    gb.click()
    check(f"{L}: Pojistka uší – zapnout jedním stiskem", wait_for(lambda: hubv("/bus/1/dyn/on") == 1 and gst.inner_text() == T["prot"]))
    # proč neslyší: MUTE Kick → důvod a oprava jedním ťuknutím
    pg.evaluate("MixtetHubSim.write('/ch/01/mix/on', 0, 'hub')")
    why = k.locator(".why")
    check(f"{L}: proč neslyší – {T['whyMute']}", wait_for(lambda: why.inner_text() == T["whyMute"]), why.inner_text())
    why.click()
    check(f"{L}: proč neslyší – vysvětlení", wait_for(lambda: tab.locator(".pop").is_visible()))
    tab.locator(".pop .btn.prim").click()
    check(f"{L}: proč neslyší – oprava zapne Kick", wait_for(lambda: hubv("/ch/01/mix/on") == 1 and not tab.locator(".pop").count()))
    # MLUVIT K TOMOVI – jen do odposlechu Toma
    tab.locator("#mon-2").click()
    wait_for(lambda: tab.locator("#talkMember").count() == 1)
    tb = tab.locator("#talkMember").bounding_box()
    pg.mouse.move(tb["x"] + tb["width"] / 2, tb["y"] + tb["height"] / 2); pg.mouse.down()
    check(f"{L}: {T['talkTom']} – jen odposlech 2", wait_for(lambda: tab.locator("#talkMember").inner_text() == T["talkTom"]
                                                       and pg.evaluate("MixtetHubSim.talkInfo() && MixtetHubSim.talkInfo().targets.join()") == "2"))
    pg.mouse.up()
    check(f"{L}: puštění = konec", wait_for(lambda: not pg.evaluate("MixtetHubSim.talking()")))
    tab.locator("#mon-1").click()
    # ---- Scény: náhled, NAČÍST dvakrát, odposlechy se nezmění, Zpět vrátí
    tab.locator("#nav-scenes").click()
    check(f"{L}: Scény – setlist, náhled, scény v pultu", wait_for(lambda: tab.locator("#setlist .song").count() == 4 and tab.locator("#diff tbody tr").count() > 1
                                                             and tab.locator(".scrow").count() == 6))
    check(f"{L}: Scény – nic pod 11 px, cíle ≥ 44 px", ipad_sizes(tab) == [0, 0], ipad_sizes(tab))
    mon = pg.evaluate("""() => { const h = MixtetHubSim, o = {}; h.strips().forEach(s => [1,2,3,4,5,6].forEach(b => { o[s.send(b)] = h.known(s.send(b)); }));
      [1,2,3,4,5,6].forEach(b => { o['/bus/'+b+'/mix/fader'] = h.known('/bus/'+b+'/mix/fader'); o['/bus/'+b+'/mix/on'] = h.known('/bus/'+b+'/mix/on'); }); return o; }""")
    kf, pl = hubv("/ch/01/mix/fader"), H("playing()")
    ld = tab.locator("#loadSong")
    ld.click()
    check(f"{L}: NAČÍST – první stisk jen připraví ({T['loadAgain']} + odpočet)", T["loadAgain"] in ld.inner_text() and H("playing()") == pl, ld.inner_text())
    ld.click()
    check(f"{L}: NAČÍST – druhý stisk načte další píseň", wait_for(lambda: H("playing()") == pl + 1))
    check(f"{L}: hláška – {T['monUnchanged']}", wait_for(lambda: T["monUnchanged"] in tab.locator("#toastT").inner_text()), tab.locator("#toastT").inner_text())
    pg.wait_for_timeout(250)
    mon2 = pg.evaluate("""() => { const h = MixtetHubSim, o = {}; h.strips().forEach(s => [1,2,3,4,5,6].forEach(b => { o[s.send(b)] = h.known(s.send(b)); }));
      [1,2,3,4,5,6].forEach(b => { o['/bus/'+b+'/mix/fader'] = h.known('/bus/'+b+'/mix/fader'); o['/bus/'+b+'/mix/on'] = h.known('/bus/'+b+'/mix/on'); }); return o; }""")
    check(f"{L}: píseň nepřepsala odposlechy (sendy a hlasitosti všech 6 odposlechů)", mon == mon2, [k2 for k2 in mon if mon[k2] != mon2.get(k2)][:5])
    check(f"{L}: píseň změnila sál (Kick na +1,5 dB jako v písni)", abs(pg.evaluate("MixtetHub.lin(MixtetHubSim.known('/ch/01/mix/fader'))") - 1.5) < 0.1,
          pg.evaluate("MixtetHub.lin(MixtetHubSim.known('/ch/01/mix/fader'))"))
    song = pg.evaluate("MixtetHubSim.setlist()[MixtetHubSim.playing()].name")
    check(f"{L}: mobil vidí novou píseň", wait_for(lambda: song in ph.locator("body").inner_text(), 4), song)
    tab.locator("#undoB").click()
    check(f"{L}: Zpět vrátí celé načtení", wait_for(lambda: abs(hubv("/ch/01/mix/fader") - kf) < 1e-6))
    # ---- Koncert: HRAJE / DALŠÍ nahoře, načtení dvojím stiskem; Kanál a Scény zamčené
    tab.locator("#mode-con").click()
    check(f"{L}: Koncert – HRAJE / DALŠÍ, bez DCA a sóla, zamčené stránky",
          wait_for(lambda: tab.locator(".nowbar").is_visible()) and not tab.locator(".dca").first.is_visible()
          and tab.locator("#nav-channel").get_attribute("aria-disabled") == "true" and tab.locator("#strips .btn.solo").first.is_hidden())
    check(f"{L}: Koncert – nic pod 11 px, cíle ≥ 44 px", ipad_sizes(tab) == [0, 0], ipad_sizes(tab))
    pl = H("playing()")
    tab.locator("#loadNext").click(); tab.locator("#loadNext").click()
    check(f"{L}: Koncert – načíst další píseň", wait_for(lambda: H("playing()") == pl + 1))
    tab.locator("#undoB").click()
    tab.locator("#mode-reh").click()
    # ---- Kapela: QR (ilustrace), dát mobil členovi
    tab.locator("#nav-band").click()
    check(f"{L}: Kapela – 4 členové s QR a Před koncertem", wait_for(lambda: tab.locator(".mcard").count() == 4 and tab.locator(".qr svg").count() == 4))
    check(f"{L}: Kapela – nic pod 11 px, cíle ≥ 44 px", ipad_sizes(tab) == [0, 0], ipad_sizes(tab))
    tab.locator("#member-2 .btn").click()
    check(f"{L}: Kapela → mobil vpravo patří Tomovi", wait_for(lambda: "Tom" in frames(pg)[1].locator("#who").inner_text(), 5))
    pg.evaluate("MixtetDemo.setMember(1)")
    wait_for(lambda: "Adam" in frames(pg)[1].locator("#who").inner_text(), 5)
    ph = frames(pg)[1]
    wait_for(lambda: ph.locator("#s-me").count() == 1, 5)
    # ---- Nastavení
    tab.locator("#nav-settings").click()
    check(f"{L}: Nastavení – pult, appka, ovladač, mobily", wait_for(lambda: tab.locator(".setgrid .card").count() == 4 and tab.locator(".chk input").count() == 2))
    check(f"{L}: Nastavení – nic pod 11 px, cíle ≥ 44 px", ipad_sizes(tab) == [0, 0], ipad_sizes(tab))
    # ---- jazyk: v EN žádná čeština (kromě vlastních jmen a volby „Čeština“)
    if L == "en":
        import re
        leaks = []
        for p in ["mixer", "channel", "monitors", "scenes", "band", "settings"]:
            tab.evaluate(f"MixtetIpad.go('{p}')")
            if p == "channel":
                for v in ["simple", "full"]:
                    tab.locator("#view-" + v).click()
                    txt = tab.evaluate("document.body.innerText + ' ' + [...document.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label')).join(' ')")
                    leaks += [w for w in re.findall(r"\S*" + CZ_CHARS + r"\S*", txt) if w != "Čeština"] + [w for w in CZ_WORDS if re.search(r"\b" + w + r"\b", txt)]
                continue
            txt = tab.evaluate("document.body.innerText + ' ' + [...document.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label')).join(' ')")
            leaks += [w for w in re.findall(r"\S*" + CZ_CHARS + r"\S*", txt) if w != "Čeština"] + [w for w in CZ_WORDS if re.search(r"\b" + w + r"\b", txt)]
        tab.evaluate("MixtetIpad.setConcert(true)")
        txt = tab.evaluate("document.body.innerText")
        tab.evaluate("MixtetIpad.setConcert(false)")
        leaks += [w for w in re.findall(r"\S*" + CZ_CHARS + r"\S*", txt)]
        check("EN: na iPadu žádná čeština (všechny stránky, i aria-label)", not leaks, sorted(set(leaks))[:20])
        ptxt = ph.locator("body").inner_text()
        check("EN: na mobilu žádná čeština", not re.findall(r"\S*" + CZ_CHARS + r"\S*", ptxt), re.findall(r"\S*" + CZ_CHARS + r"\S*", ptxt)[:10])
    tab.locator("#nav-mixer").click()
    wait_for(lambda: tab.locator("#strips .lane").count() == 17)


def pend_probe(frame):
    # zaznamená, jestli se během akce objevila třída „pend“ (číslo čeká na pult)
    frame.evaluate("""() => { window.__pend = 0; new MutationObserver(m => { for (const r of m) if (r.target.classList && r.target.classList.contains('pend')) window.__pend++; })
      .observe(document.body, {subtree: true, attributes: true, attributeFilter: ['class']}); }""")


with sync_playwright() as p:
    b = p.chromium.launch()
    # ---------------------------------------------------------------- desktop CS
    ctx = b.new_context(viewport={"width": 1440, "height": 900}, locale="cs-CZ")
    ctx.add_init_script(FAKE_MIDI)
    pg = ctx.new_page()
    errors = []
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(BASE + "/demo/cs/")
    tab, ph = ready(pg)
    check("iframy načtené (iPad hub: 17 pásů Mixeru, mobil Hlasitost)", tab.locator("#strips .lane").count() == 17, tab.locator("#strips .lane").count())
    check("mobil = Adam (odposlech 1)", "Adam" in ph.locator("#who").inner_text())
    check("iPad: připojeno", wait_for(lambda: tab.locator("#connT").inner_text() == "XR18 · připojeno"))
    pg.wait_for_timeout(1500)
    pg.screenshot(path=f"{SHOTS}/desktop-1440-cs.png")
    # iPad jako samostatný hub: stránky jako Mac, Mixer s pravým sloupcem (Živé akce, MLUVIT, DCA), Sál, banky
    v2 = tab.evaluate("""() => ({strips: document.querySelectorAll('#strips .lane').length, sk: document.querySelectorAll('.groups .sk').length,
      nav: [...document.querySelectorAll('#nav button')].map(b => b.textContent), modes: [...document.querySelectorAll('#modeSeg button')].map(b => b.textContent),
      dca: [...document.querySelectorAll('.dca')].filter(r => r.querySelector('.hs[role=slider]') && r.querySelector('.btn.mute')).length,
      banks: [...document.querySelectorAll('#banks .bank')].map(b => b.textContent), banksShown: !document.getElementById('banks').hidden,
      main: !!document.querySelector('.mainl .fader[role=slider]') && !!document.querySelector('.mainl .btn.mute'),
      scale: document.querySelectorAll('#strips .lane .scale span').length, owner: document.querySelectorAll('#strips .tile .own').length,
      talk: document.getElementById('talk').textContent, hint: document.getElementById('talk').nextElementSibling.textContent,
      allMon: document.getElementById('allMon').textContent, quiet: !!document.getElementById('quietAll'),
      w: innerWidth, h: innerHeight })""")
    check("iPad: 1180 × 820 (zmenšený obalem)", v2["w"] == 1180 and v2["h"] == 820, v2)
    check("iPad: stránky jako Mac + Zkouška / Koncert", v2["nav"] == ["Mixer", "Kanál", "Odposlechy", "Scény", "Kapela", "Nastavení"]
          and v2["modes"] == ["Zkouška", "Koncert"], v2)
    check("iPad: 17 pásů se stupnicí a iniciálou vlastníka", v2["strips"] == 17 and v2["scale"] == 17 * 9 and v2["owner"] == 9, v2)
    check("iPad: Živé akce – 4 mute skupiny, Ztlumit všechny odposlechy, −6 dB, MLUVIT, 4 DCA",
          v2["talk"] == "MLUVIT KE KAPELE (drž)" and "sál neslyší" in v2["hint"] and v2["sk"] == 4 and v2["dca"] == 4
          and v2["allMon"] == "Ztlumit všechny odposlechy" and v2["quiet"], v2)
    check("iPad: pás Sál s faderem a MUTE", v2["main"], v2)
    check("iPad: banky po 8 (Banka 1–3)", v2["banks"] == ["Banka 1", "Banka 2", "Banka 3"] and v2["banksShown"], v2)
    check("iPad: nic pod 11 px, cíle ≥ 44 px (Mixer)", ipad_sizes(tab) == [0, 0], ipad_sizes(tab))
    tab.locator("#banks .bank").nth(1).click()
    check("iPad: Banka 2 posune pásy (9. pás vlevo)", wait_for(lambda: tab.evaluate("""() => { const s = document.getElementById('strips');
      return s.scrollLeft > 0 && Math.abs(s.children[8].offsetLeft - s.children[0].offsetLeft - s.scrollLeft) < 4; }""") and tab.locator("#banks .bank").nth(1).get_attribute("aria-pressed") == "true", 3))
    tab.locator("#banks .bank").nth(0).click()
    check("iPad: Banka 1 zpět", wait_for(lambda: tab.evaluate("document.getElementById('strips').scrollLeft") == 0, 3))
    check("1440: bez vodorovného posunu stránky", pg.evaluate("document.documentElement.scrollWidth <= innerWidth"),
          pg.evaluate("[document.documentElement.scrollWidth, innerWidth]"))
    # přepínač zařízení: iPad výchozí, Mac = snímky v okně macOS, mobil zůstává
    check("přepínač: iPad vybraný, Mobil jen na úzkém", pg.locator("#tab-tablet").get_attribute("aria-selected") == "true"
          and pg.locator("#tab-mac").is_visible() and not pg.locator("#tab-phone").is_visible())
    TO_TABS = "window.scrollTo({top: document.querySelector('.tabs').getBoundingClientRect().top + scrollY - 76, behavior: 'instant'})"
    pg.evaluate(TO_TABS); pg.wait_for_timeout(400)
    pg.screenshot(path=f"{SHOTS}/desktop-1440-cs-ipad.png")
    pg.locator("#tab-mac").click()
    check("Mac: galerie vidět, iPad skrytý, mobil zůstává", pg.locator("#macGallery").is_visible() and not pg.locator("#pane-tablet").is_visible()
          and pg.locator("#pane-phone").is_visible())
    check("Mac: 1. snímek Mixer + poznámka", wait_for(lambda: "Mixer" in pg.locator("#macTitle").inner_text() and pg.locator("#macCount").inner_text() == "1 z 6")
          and "interaktivně vyzkoušej" in pg.locator("#pane-mac").inner_text(), pg.locator("#macTitle").inner_text())
    check("Mac: obrázek načtený", wait_for(lambda: pg.evaluate("[...document.querySelectorAll('.mslide')].filter(f => !f.hidden).map(f => f.querySelector('img').naturalWidth)[0] > 0"), 3))
    pg.locator("#macNext").click()
    check("Mac: šipka › = Odposlechy (2 z 6)", pg.locator("#macCount").inner_text() == "2 z 6" and "Odposlechy" in pg.locator("#macTitle").inner_text())
    pg.locator("#macGallery").focus()
    pg.keyboard.press("ArrowLeft"); pg.keyboard.press("ArrowLeft")
    check("Mac: klávesa ← dokola na Scény (6 z 6)", pg.locator("#macCount").inner_text() == "6 z 6" and "Scény" in pg.locator("#macTitle").inner_text())
    pg.locator(".mdot").nth(2).click()
    check("Mac: tečka Koncert", pg.locator("#macCount").inner_text() == "3 z 6" and pg.locator(".mdot").nth(2).get_attribute("aria-pressed") == "true")
    mt = pg.evaluate("[...document.querySelectorAll('#pane-mac button, .tabs button')].filter(e => e.offsetParent).map(e => e.getBoundingClientRect().height).filter(h => h < 44).length")
    check("Mac: cíle ≥ 44 px", mt == 0, mt)
    pg.locator("#tab-mac").focus()
    pg.keyboard.press("ArrowLeft")
    check("přepínač: klávesa ← zpět na iPad", pg.locator("#tab-tablet").get_attribute("aria-selected") == "true" and pg.locator("#pane-tablet").is_visible())
    pg.locator("#tab-mac").click(); pg.locator("#macPrev").click(); pg.locator("#macPrev").click()
    pg.evaluate(TO_TABS); pg.wait_for_timeout(500)
    pg.screenshot(path=f"{SHOTS}/desktop-1440-cs-mac.png")
    pg.locator("#tab-tablet").click()

    # iPad fader: ↑ = +1 dB, číslo čeká kurzívou, pak potvrzení echem
    pend_probe(tab)
    kick = tab.locator('#strips .lane[data-id="/ch/01"]')
    kick.locator(".fader").focus()
    pg.keyboard.press("ArrowUp")
    check("iPad: čekající hodnota kurzívou …", wait_for(lambda: tab.evaluate("window.__pend") > 0, 1))
    check("iPad: potvrzeno +1.0 bez …", wait_for(lambda: kick.locator(".val").inner_text() == "+1.0" and "pend" not in kick.locator(".val").get_attribute("class")),
          kick.locator(".val").inner_text())
    check("hub: /ch/01 fader potvrzen", abs(pg.evaluate("MixtetHubSim.known('/ch/01/mix/fader')") - 0.775) < 0.01)

    # mobil: Hlasitost ↑ → pending → potvrzeno
    pend_probe(ph)
    before = pg.evaluate("MixtetHubSim.known('/bus/1/mix/fader')")
    ph.locator("#s-me").focus()
    pg.keyboard.press("ArrowUp")
    check("mobil: čekající hodnota kurzívou …", wait_for(lambda: ph.evaluate("window.__pend") > 0, 1))
    check("mobil: hub potvrdil zápis odposlechu 1",
          wait_for(lambda: pg.evaluate("MixtetHubSim.known('/bus/1/mix/fader')") > before + 0.01))
    check("mobil: číslo potvrzené (+1.0 dB)", wait_for(lambda: ph.locator("#s-me").locator("xpath=ancestor::div[contains(@class,'big')]").locator(".val").inner_text() == "+1.0 dB"))

    # zámek: mobil nesmí sál ani cizí odposlech (server 403)
    st = ph.evaluate("""async () => { const a = await fetch('/api/m/demo-m1/set', {method:'POST', body: JSON.stringify({a:'/lr/mix/fader', v:1})});
      const b = await fetch('/api/m/demo-m1/set', {method:'POST', body: JSON.stringify({a:'/ch/01/mix/02/level', v:1})}); return [a.status, b.status]; }""")
    check("mobil: sál a cizí odposlech = 403", st == [403, 403], st)

    # iPad MUTE Kick → mobil „ztlumeno v mixu“ (Kanály zvlášť)
    ph.locator("#bDetail").click()
    kick.locator(".btn.mute").click()
    check("iPad → mobil: MUTE Kick = „ztlumeno v mixu“", wait_for(lambda: ph.locator('[data-sil="/ch/01"]').inner_text() == "ztlumeno v mixu", 3),
          ph.locator('[data-sil="/ch/01"]').inner_text())
    kick.locator(".btn.mute").click()
    check("iPad → mobil: zase hraje", wait_for(lambda: ph.locator('[data-sil="/ch/01"]').inner_text() == "", 3))

    # mute skupina 1 z iPadu
    sk1 = tab.locator("#mg1")
    sk1.click()
    check("SK1 Nástroje svítí (aria-pressed)", wait_for(lambda: sk1.get_attribute("aria-pressed") == "true"))
    col = tab.evaluate("""() => { const b = document.querySelector('#mg1'), cs = getComputedStyle(document.documentElement);
      const probe = c => { const d = document.createElement('div'); d.style.color = cs.getPropertyValue(c); document.body.append(d); const v = getComputedStyle(d).color; d.remove(); return v; };
      return {bg: getComputedStyle(b).backgroundColor, mute: probe('--krai-mute'), ind: probe('--krai-mute-indirect'), txt: b.getAttribute('aria-label')}; }""")
    check("SK1 svítí oranžově (nepřímé ztlumení), ne červeně jako MUTE", col["bg"] != col["mute"] and col["bg"] == col["ind"] and "ztlumuje" in col["txt"], col)
    check("hub: /config/mute/1 = 1", wait_for(lambda: pg.evaluate("MixtetHubSim.known('/config/mute/1')") == 1))
    check("mobil: Kick „ztlumeno v mixu – skupina“", wait_for(lambda: "skupina" in ph.locator('[data-sil="/ch/01"]').inner_text(), 3))
    check("prohlídka: úkol 2 ✓", wait_for(lambda: "done" in pg.locator("#step-b").get_attribute("class")))
    sk1.click()
    wait_for(lambda: sk1.get_attribute("aria-pressed") == "false")

    # MLUVIT KE KAPELE (drž) z iPadu → Zpěv Adam na 0 dB do odposlechů, po puštění zpět
    talk_before = pg.evaluate("MixtetHubSim.known('/ch/04/mix/01/level')")
    tab.locator("#talk").scroll_into_view_if_needed()
    tb = tab.locator("#talk").bounding_box()
    pg.mouse.move(tb["x"] + tb["width"] / 2, tb["y"] + tb["height"] / 2)
    pg.mouse.down()
    check("MLUVÍŠ KE KAPELE svítí", wait_for(lambda: tab.locator("#talk").inner_text() == "MLUVÍŠ KE KAPELE"))
    check("hub: mikrofon v odposlechu Adama na 0 dB", wait_for(lambda: abs(pg.evaluate("MixtetHubSim.known('/ch/04/mix/01/level')") - 0.75) < 0.01))
    pg.wait_for_timeout(1200)
    check("MLUVIT drží déle než 1 s (obnova z iPadu)", pg.evaluate("MixtetHubSim.talking()"))
    pg.mouse.up()
    check("po puštění zpět na původní send", wait_for(lambda: abs(pg.evaluate("MixtetHubSim.known('/ch/04/mix/01/level')") - talk_before) < 0.01))
    check("prohlídka: úkol 5 (MLUVIT) ✓", "done" in pg.locator("#step-e").get_attribute("class"))

    # obrazovky iPad hubu (Kanál, Odposlechy, Scény, Koncert, Kapela, Nastavení) – a prohlídka 3 a 4
    ipad_screens(pg, tab, ph, "cs")
    check("prohlídka: úkol 3 (další píseň) ✓", "done" in pg.locator("#step-c").get_attribute("class"))
    check("prohlídka: úkol 4 (Kick čistší) ✓", "done" in pg.locator("#step-d").get_attribute("class"))
    tab, ph = frames(pg)
    kick = tab.locator('#strips .lane[data-id="/ch/01"]')

    # výpadek pultu: stránky ukážou své stavy, pak obnova bez zápisů (zákon 3)
    pg.wait_for_timeout(250)  # echa vrácení MLUVIT (odposlechy 1–4, 40–80 ms) ať nespadnou do počítadla výpadku
    pg.evaluate("window.__writes = 0; window.__wl = []; MixtetHubSim.on('change', c => { window.__writes++; window.__wl.push(c); })")
    pg.locator("#outage").click()
    check("výpadek: iPad „pult neodpovídá“", wait_for(lambda: tab.locator("#connT").inner_text() == "pult neodpovídá", 2))
    check("výpadek: mobil banner", wait_for(lambda: "pult neodpovídá" in ph.locator("#banner").inner_text() and ph.locator("#banner").is_visible(), 2))
    pg.wait_for_timeout(1700)
    check("výpadek: měřáky mobilu šrafované (stale)", ph.locator(".mt.stale").count() > 0)
    kick.locator(".fader").focus()
    pg.keyboard.press("ArrowUp")
    check("výpadek: iPad červený pruh „Bez spojení s pultem“ a šrafované měřáky", tab.locator("#banner").is_visible()
          and "Bez spojení s pultem" in tab.locator("#banner").inner_text() and tab.locator(".meter.stale").count() > 10)
    check("výpadek: zápis odmítnut toastem", wait_for(lambda: "Bez spojení" in tab.locator("#toastT").inner_text(), 1))
    pg.evaluate("document.getElementById('stage').scrollIntoView()")
    pg.screenshot(path=f"{SHOTS}/outage-1440-cs.png")
    check("po obnově: iPad připojeno", wait_for(lambda: tab.locator("#connT").inner_text() == "XR18 · připojeno", 6))
    check("po obnově: mobil bez banneru", wait_for(lambda: not ph.locator("#banner").is_visible(), 3))
    pg.wait_for_timeout(500)
    check("po obnově: nic se znovu neposlalo", pg.evaluate("window.__writes") == 0, pg.evaluate("window.__wl"))

    # prohlídka 1: Tom si ubere kytaru a přidá zpěv
    pg.locator("#toTom").click()
    pg.wait_for_timeout(300)
    tab, ph = ready(pg)
    check("mobil přepnut na Toma", wait_for(lambda: "Tom" in ph.locator("#who").inner_text(), 4))
    if ph.locator("#detail").count() == 0:
        ph.locator("#bDetail").click()
    ph.locator('[id="s-/ch/12"]').focus()
    pg.keyboard.press("PageDown")
    ph.locator('[id="s-/ch/04"]').focus()
    pg.keyboard.press("PageUp")
    check("prohlídka: úkol 1 ✓", wait_for(lambda: "done" in pg.locator("#step-a").get_attribute("class"), 3))
    check("prohlídka hotová: výzva k betě", wait_for(lambda: pg.locator("#tourDone").is_visible()))
    pg.wait_for_timeout(1200)
    pg.evaluate("document.getElementById('tour').scrollIntoView()")
    pg.screenshot(path=f"{SHOTS}/tour-done-1440-cs.png")

    # MIDI: falešný nanoKONTROL Studio
    unit = pg.evaluate("""() => { const M = MixtetMIDI; return {
      studio: (M.matchProfile('nanoKONTROL Studio', window.__profiles) || {}).id,
      two: (M.matchProfile('nanoKONTROL2 SLIDER/KNOB', window.__profiles) || {}).id,
      none: M.matchProfile('Some Synth', window.__profiles),
      st1: M.softTakeover(null, 0.1, 0.75, false, null, true), st2: M.softTakeover(0.7, 0.8, 0.75, false, null, true),
      st3: M.softTakeover(null, 0.76, 0.75, false, null, true), st4: M.softTakeover(0.76, 0.5, 0.9, true, 0.76, true) }; }"""
                       .replace("window.__profiles", "[]"))
    check("MIDI unit: bez profilů nic", unit["studio"] is None and unit["none"] is None)
    check("SoftTakeover: daleko = nic, přejetí = chytí, blízko = chytí, cizí změna = pustí",
          unit["st1"]["send"] is None and unit["st2"]["caught"] and unit["st3"]["caught"] and unit["st4"]["send"] is None, unit)
    unit2 = pg.evaluate("""async () => { const files = await (await fetch('/demo/profiles/index.json')).json();
      const ps = await Promise.all(files.map(f => fetch('/demo/profiles/' + f).then(r => r.json()))); const M = MixtetMIDI;
      const st = M.matchProfile('nanoKONTROL Studio', ps);
      return {n: ps.length, studio: st && st.id, two: (M.matchProfile('nanoKONTROL2 SLIDER/KNOB', ps) || {}).id,
        none: M.matchProfile('Some Synth', ps), fader: M.resolve(st, [0xBF, 3, 127]), mute: M.resolve(st, [0xBF, 49, 127]),
        wrongCh: M.resolve(st, [0xB0, 3, 127]), led: M.ledBytes(st, 'mute', 2, true), play: M.resolve(st, [0xBF, 41, 0]) }; }""")
    check("MIDI unit: profily načtené a rozpoznané", unit2["n"] == 6 and unit2["studio"] == "korg-nanokontrol-studio"
          and unit2["two"] == "korg-nanokontrol2" and unit2["none"] is None, unit2)
    check("MIDI unit: překlad CC na sloty a LED", unit2["fader"] == {"slot": "fader", "index": 3, "value": {"absolute": 1}}
          and unit2["mute"]["slot"] == "mute" and unit2["mute"]["index"] == 1 and unit2["wrongCh"] is None
          and unit2["led"] == [0xBF, 50, 127] and unit2["play"]["value"] == {"pressed": False}, unit2)

    pg.locator("#midi").click()
    check("MIDI: chip „Ovladač: … Banka 1“", wait_for(lambda: "Banka 1: Kick" in pg.locator("#midiChip").inner_text(), 3), pg.locator("#midiChip").inner_text())
    pg.wait_for_timeout(200)
    check("MIDI: LED synchronizace po připojení", len(pg.evaluate("window.__midiOut")) >= 8)
    cur = pg.evaluate("MixtetHubSim.known('/ch/01/mix/fader')")
    pg.evaluate("__midiIn([0xBF, 0, 10])")  # daleko od mixu → pickup nic nepošle
    pg.wait_for_timeout(200)
    check("MIDI: pickup – daleko od hodnoty nic", abs(pg.evaluate("MixtetHubSim.known('/ch/01/mix/fader')") - cur) < 1e-6)
    hw = round(cur * 127)
    pg.evaluate(f"__midiIn([0xBF, 0, {hw}])")
    pg.evaluate("__midiIn([0xBF, 0, 110])")
    check("MIDI: fader chytil a hýbe kanálem", wait_for(lambda: abs(pg.evaluate("MixtetHubSim.known('/ch/01/mix/fader')") - 110 / 127) < 0.01))
    check("MIDI → iPad: číslo Kick se změnilo", wait_for(lambda: kick.locator(".val").inner_text() in ("+4.6", "+4.7")), kick.locator(".val").inner_text())
    pg.evaluate("window.__midiOut.length = 0; __midiIn([0xBF, 48, 127]); __midiIn([0xBF, 48, 0])")
    check("MIDI: Mute 1 ztlumí Kick", wait_for(lambda: pg.evaluate("MixtetHubSim.known('/ch/01/mix/on')") == 0))
    check("MIDI: LED Mute 1 svítí", wait_for(lambda: [0xBF, 48, 127] in pg.evaluate("window.__midiOut")))
    check("MIDI → iPad: MUTE Kick svítí", wait_for(lambda: kick.locator(".btn.mute").get_attribute("aria-pressed") == "true"))
    pg.evaluate("__midiIn([0xBF, 48, 127]); __midiIn([0xBF, 48, 0]); __midiIn([0xBF, 41, 127]); __midiIn([0xBF, 41, 0])")
    check("MIDI: Play = mute skupina 1", wait_for(lambda: pg.evaluate("MixtetHubSim.known('/config/mute/1')") == 1))
    check("MIDI: LED Play svítí", wait_for(lambda: [0xBF, 41, 127] in pg.evaluate("window.__midiOut")))
    pg.evaluate("__midiIn([0xBF, 41, 127]); __midiIn([0xBF, 41, 0]); __midiIn([0xBF, 59, 127]); __midiIn([0xBF, 59, 0])")
    check("MIDI: Track ▶ = Banka 2", wait_for(lambda: "Banka 2" in pg.locator("#midiChip").inner_text()), pg.locator("#midiChip").inner_text())
    check("MIDI → iPad: banka jde za ovladačem (Banka 2, F1 na 9. pásu)", wait_for(lambda: tab.locator("#banks .bank").nth(1).get_attribute("aria-pressed") == "true"
          and tab.locator("#strips .lane").nth(8).locator(".fbadge").inner_text() == "F1"))
    tab.locator("#banks .bank").nth(2).click()
    check("iPad → MIDI: Banka 3 na iPadu přepne ovladač", wait_for(lambda: "Banka 3" in pg.locator("#midiChip").inner_text()), pg.locator("#midiChip").inner_text())
    check("iPad: čip ovladače v liště", wait_for(lambda: "Banka 3" in tab.locator("#ctrlChip").inner_text()), tab.locator("#ctrlChip").inner_text())
    tab.locator("#banks .bank").nth(1).click()
    wait_for(lambda: "Banka 2" in pg.locator("#midiChip").inner_text())
    pg.evaluate("__midiIn([0xBF, 45, 127])")
    check("MIDI: Rec (drž) = MLUVIT KE KAPELE", wait_for(lambda: pg.evaluate("MixtetHubSim.talking()")))
    pg.evaluate("__midiIn([0xBF, 45, 0])")
    check("MIDI: puštění Rec pustí MLUVIT", wait_for(lambda: not pg.evaluate("MixtetHubSim.talking()")))
    check("MIDI: ladicí výpis", "record" in pg.locator("#midiLog").text_content() and pg.locator("#midiDbg").is_visible())

    # zpětná vazba (počká 3 s od načtení – ochrana proti robotům)
    pg.locator("#fbOpen").click()
    pg.locator("#fbMsg").fill("Test z Playwright: fader na iPadu je super.")
    pg.locator("#fbEmail").fill("test@example.com")
    pg.locator("#fbSend").click()
    check("zpětná vazba odeslána", wait_for(lambda: pg.locator("#fbOk").is_visible(), 3))
    pg.keyboard.press("Escape")
    adm = admin()
    check("admin: zpětná vazba se zdrojem demo a kontextem", "Test z Playwright" in adm and "ukázka: úkol=" in adm and "<td>demo</td>" in adm)
    check("admin: demo_stats start / tour_done / midi_connected", all(x in adm for x in ["start <b>", "tour_done <b>", "midi_connected <b>"]))
    check("konzole bez chyb (desktop CS)", not errors, errors[:5])
    ctx.close()

    # ---------------------------------------------------------------- Mackie Control (DAW režim, nanoKONTROL přes Bluetooth)
    ctx = b.new_context(viewport={"width": 1440, "height": 900}, locale="cs-CZ")
    ctx.add_init_script(FAKE_MIDI_PORTS % '["nanoKONTROL Studio", "BLE MIDI Device"]')
    pg = ctx.new_page()
    errors = []
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(BASE + "/demo/cs/")
    tab, ph = ready(pg)
    NK, BLE = "nanoKONTROL Studio", "BLE MIDI Device"
    send = lambda port, bytes_js: pg.evaluate(f"__midiInBy[{port!r}]({bytes_js})")
    out = lambda port: pg.evaluate(f"__midiOutBy[{port!r}]")

    # kodek (port MCUCodec.swift) a MotorFollower – čisté funkce
    u = pg.evaluate("""() => { const M = MixtetMIDI.MCU, F = MixtetMIDI.createMotorFollower;
      const m = F(); const a = m.follow(0, 0.75), b = m.follow(0, 0.75), c = m.follow(0, 0.7505), d = m.follow(0, 0.8);
      const t = F(); t.touch(3, true); t.moved(3, 0.6); const t1 = t.follow(3, 0.55); t.touch(3, false); t.moved(3, 0.6);
      const t2 = t.follow(3, 0.6 + 1 / 2047), t3 = t.follow(3, 0.2);
      return {pbFull: M.decode([0xE2, 0x7F, 0x7F]), pbMaster: M.decode([0xE8, 0, 0x40]), pbCh10: M.decode([0xE9, 0, 0x40]),
        mute: M.decode([0x90, 16, 127]), muteOff: M.decode([0x80, 16, 0]), sel: M.decode([0x90, 31, 127]),
        bankL: M.decode([0x90, 46, 127]).button, bankR: M.decode([0x90, 47, 127]).button, chR: M.decode([0x90, 49, 127]).button,
        play: M.decode([0x90, 94, 127]).button, stop: M.decode([0x90, 93, 127]).button, rec: M.decode([0x90, 95, 127]).button,
        recStrip: M.decode([0x90, 3, 127]), solo: M.decode([0x90, 9, 127]), push: M.decode([0x90, 33, 127]),
        touch: M.decode([0x90, 104, 127]), touchMaster: M.decode([0x90, 112, 0]), noteCh2: M.decode([0x91, 16, 127]),
        vpR: M.decode([0xB0, 16, 1]), vpL: M.decode([0xB0, 23, 65]), vp0: M.decode([0xB0, 16, 0]), cc1: M.decode([0xB0, 1, 65]),
        jog: M.decode([0xB0, 60, 65]), led: M.led('mute', 2, true), ledOff: M.led('play', null, false), ledPlay: M.led('play', null, true),
        fader: M.fader(8, 1), fader9: M.fader(9, 1), raw: M.faderRaw(0.75), vv: [M.vpotValue(-3), M.vpotValue(100), M.vpotValue(0)],
        lcd: M.lcdDisplay(['Zpěv M', 'Kytara Tom'], ['Sal']), row: M.lcdRow(['A'], 1), ascii: M.ascii('Zpěv →'),
        slots: ['rec', 'flip', 'channelLeft', 'vpotPush', 'play'].map(M.slot),
        nameXT: M.isMCUName('X-Touch INT'), nameMini: M.isMCUName('X-TOUCH MINI'), nameNK: M.isMCUName('nanoKONTROL Studio'),
        motor: [a, b, c, d != null], echo: [t1, t2, t3 != null] }; }""")
    check("MCU: Pitch Bend 14 bit → fader (pás 3 = 1.0, master kanál 9, kanál 10 nic)",
          u["pbFull"] == {"type": "fader", "strip": 2, "value": 1} and u["pbMaster"]["strip"] == 8 and abs(u["pbMaster"]["value"] - 8192 / 16383) < 1e-9
          and u["pbCh10"] is None, u)
    check("MCU: noty MUTE 16–23, SELECT 24–31, REC 0–7, SOLO 8–15, V‑Pot push 32–39",
          u["mute"] == {"type": "button", "button": "mute", "note": 16, "strip": 0, "pressed": True} and u["muteOff"]["pressed"] is False
          and u["sel"]["button"] == "select" and u["sel"]["strip"] == 7 and u["recStrip"]["button"] == "rec" and u["recStrip"]["strip"] == 3
          and u["solo"]["button"] == "solo" and u["solo"]["strip"] == 1 and u["push"]["button"] == "vpotPush" and u["push"]["strip"] == 1, u)
    check("MCU: Bank ◀▶ 46/47, Channel ▶ 49, Play 94, Stop 93, Rec 95",
          [u["bankL"], u["bankR"], u["chR"], u["play"], u["stop"], u["rec"]] == ["bankLeft", "bankRight", "channelRight", "play", "stop", "record"], u)
    check("MCU: dotyk 104–112, nota na kanálu 2 nic", u["touch"] == {"type": "touch", "strip": 0, "touched": True}
          and u["touchMaster"] == {"type": "touch", "strip": 8, "touched": False} and u["noteCh2"] is None, u)
    check("MCU: V‑Pot CC 16–23 sign-magnitude, CC 1 neznámé, kolečko CC 60",
          u["vpR"] == {"type": "vpot", "strip": 0, "delta": 1} and u["vpL"] == {"type": "vpot", "strip": 7, "delta": -1}
          and u["vp0"] is None and u["cc1"] is None and u["jog"] == {"type": "jog", "delta": -1} and u["vv"] == [67, 63, 0], u)
    check("MCU: LED = Note On 127 / 0, motor = Pitch Bend zpět", u["led"] == [0x90, 18, 127] and u["ledOff"] == [0x90, 94, 0]
          and u["ledPlay"] == [0x90, 94, 127] and u["fader"] == [0xE8, 0x7F, 0x7F] and u["fader9"] is None and u["raw"] == 12287, u)
    check("MCU: LCD SysEx F0 00 00 66 14 12, 2 × 56 znaků, bez diakritiky",
          u["lcd"][:7] == [0xF0, 0, 0, 0x66, 0x14, 0x12, 0] and len(u["lcd"]) == 7 + 112 + 1 and u["lcd"][-1] == 0xF7
          and bytes(u["lcd"][7:14]).decode() == "Zpev M " and bytes(u["lcd"][14:21]).decode() == "Kytara " and bytes(u["lcd"][63:70]).decode() == "Sal    "
          and u["row"][6] == 56 and u["ascii"] == list(b"Zpev ?"), u["lcd"][:24])
    check("MCU: role tlačítek jako MCUMapping (FLIP = cycle, Channel/push bez role)", u["slots"] == ["rec", "cycle", None, None, "play"], u["slots"])
    check("MCU: rozpoznání jménem (X‑Touch ano, Mini a nanoKONTROL ne)", u["nameXT"] and not u["nameMini"] and not u["nameNK"], u)
    check("MotorFollower: jednou, pak jen skutečná změna", u["motor"][0] == [0xE0, 0x7F, 0x5F] and u["motor"][1] is None and u["motor"][2] is None and u["motor"][3], u["motor"])
    check("MotorFollower: dotyk drží motor, echo vlastního tahu nic, scéna pohne", u["echo"] == [None, None, True], u["echo"])

    # připojení: nanoKONTROL podle jména = CC profil, první Pitch Bend přepne na Mackie Control
    pg.locator("#midi").click()
    check("MCU: nejdřív CC profil (Banka 1)", wait_for(lambda: "Banka 1: Kick" in pg.locator("#midiChip").inner_text(), 3), pg.locator("#midiChip").inner_text())
    cur = pg.evaluate("MixtetHubSim.known('/ch/01/mix/fader')")
    send(NK, pb(0, 0.05))  # daleko od pultu: přepne režim, ale pickup nic nepošle
    check("MCU: auto-detekce z Pitch Bend → chip „(DAW / Mackie)“",
          wait_for(lambda: "Korg nanoKONTROL Studio (DAW / Mackie) · Banka 1: Kick" in pg.locator("#midiChip").inner_text()), pg.locator("#midiChip").inner_text())
    check("MCU: hláška o režimu DAW", wait_for(lambda: "režimu DAW" in pg.locator("#status").inner_text()), pg.locator("#status").inner_text())
    check("MCU: LED po přepnutí jako noty (MUTE 1 nesvítí)", wait_for(lambda: [0x90, 16, 0] in out(NK) and [0x90, 94, 0] in out(NK)))
    pg.wait_for_timeout(150)
    check("MCU: pickup – daleko od hodnoty nic", abs(pg.evaluate("MixtetHubSim.known('/ch/01/mix/fader')") - cur) < 1e-6)

    # fader: chytí na hodnotě pultu, pak hýbe kanálem; hodnota čeká (pending), pak potvrzená na iPadu
    send(NK, pb(0, cur))
    send(NK, pb(0, 0.9))
    pend = pg.evaluate("[MixtetHubSim.get('/ch/01/mix/fader'), MixtetHubSim.known('/ch/01/mix/fader')]")
    check("MCU: Pitch Bend → fader čeká na pult (pending ≠ known)", abs(pend[0] - 921 / 1023) < 1e-6 and abs(pend[1] - 921 / 1023) > 0.01, pend)
    check("MCU: pult potvrdil fader 0.9", wait_for(lambda: abs(pg.evaluate("MixtetHubSim.known('/ch/01/mix/fader')") - 921 / 1023) < 1e-6))
    kick = tab.locator('#strips .lane[data-id="/ch/01"]')
    check("MCU → iPad: Kick +6.0 potvrzeno", wait_for(lambda: kick.locator(".val").inner_text() == "+6.0" and "pend" not in kick.locator(".val").get_attribute("class")),
          kick.locator(".val").inner_text())

    # master fader (kanál 9) = sál
    main = pg.evaluate("MixtetHubSim.known('/lr/mix/fader')")
    send(NK, pb(8, main)); send(NK, pb(8, 0.5))
    check("MCU: master fader = sál", wait_for(lambda: abs(pg.evaluate("MixtetHubSim.known('/lr/mix/fader')") - 0.5) < 0.002))

    # MUTE 1 → mute + LED, mobil ukáže „ztlumeno v mixu“
    pg.evaluate("__midiOutBy['nanoKONTROL Studio'].length = 0")
    send(NK, "[0x90, 16, 127]"); send(NK, "[0x90, 16, 0]")
    check("MCU: MUTE 1 ztlumí Kick", wait_for(lambda: pg.evaluate("MixtetHubSim.known('/ch/01/mix/on')") == 0))
    check("MCU: LED MUTE 1 = Note On 16 / 127", wait_for(lambda: [0x90, 16, 127] in out(NK)), out(NK))
    if ph.locator("#detail").count() == 0:
        ph.locator("#bDetail").click()
    check("MCU → mobil: Kick „ztlumeno v mixu“", wait_for(lambda: ph.locator('[data-sil="/ch/01"]').inner_text() == "ztlumeno v mixu", 3),
          ph.locator('[data-sil="/ch/01"]').inner_text())
    send(NK, "[0x90, 16, 127]"); send(NK, "[0x80, 16, 0]")
    check("MCU: MUTE 1 znovu = zní, LED zhasne", wait_for(lambda: pg.evaluate("MixtetHubSim.known('/ch/01/mix/on')") == 1 and out(NK)[-1] == [0x90, 16, 0]), out(NK)[-3:])

    # SELECT 2, V‑Pot = pan, SOLO v ukázce nic
    send(NK, "[0x90, 25, 127]"); send(NK, "[0x90, 25, 0]")
    check("MCU: SELECT 2 vybere kanál + LED", wait_for(lambda: pg.evaluate("MixtetHubSim.selected()") == "/ch/02" and [0x90, 25, 127] in out(NK)))
    pan = pg.evaluate("MixtetHubSim.known('/ch/01/mix/pan')")
    send(NK, "[0xB0, 16, 5]")
    check("MCU: V‑Pot 1 doprava = pan +5 %", wait_for(lambda: abs(pg.evaluate("MixtetHubSim.known('/ch/01/mix/pan')") - (pan + 0.05)) < 1e-6))
    send(NK, "[0xB0, 16, 0x42]")
    check("MCU: V‑Pot 1 doleva = pan −2 %", wait_for(lambda: abs(pg.evaluate("MixtetHubSim.known('/ch/01/mix/pan')") - (pan + 0.03)) < 1e-6))
    send(NK, "[0xB0, 1, 65]")
    check("MCU: neznámé CC 1 v ladicím výpisu", wait_for(lambda: "CC 1 = 65 (MCU)" in pg.locator("#midiLog").text_content()))

    # Play = SK1, Rec drž = MLUVIT KE KAPELE
    send(NK, "[0x90, 94, 127]"); send(NK, "[0x90, 94, 0]")
    check("MCU: Play = mute skupina 1", wait_for(lambda: pg.evaluate("MixtetHubSim.known('/config/mute/1')") == 1))
    check("MCU: LED Play = Note On 94 / 127", wait_for(lambda: [0x90, 94, 127] in out(NK)))
    check("MCU → iPad: SK1 svítí", wait_for(lambda: tab.locator("#mg1").get_attribute("aria-pressed") == "true"))
    send(NK, "[0x90, 94, 127]"); send(NK, "[0x90, 94, 0]")
    wait_for(lambda: pg.evaluate("MixtetHubSim.known('/config/mute/1')") == 0)
    send(NK, "[0x90, 95, 127]")
    check("MCU: Rec (drž) = MLUVIT KE KAPELE + LED", wait_for(lambda: pg.evaluate("MixtetHubSim.talking()") and [0x90, 95, 127] in out(NK)))
    send(NK, "[0x90, 95, 0]")
    check("MCU: puštění Rec pustí MLUVIT", wait_for(lambda: not pg.evaluate("MixtetHubSim.talking()")))

    # Bank ▶ = další banka (pásy 9–16), pickup znovu, LED znovu; Bank ◀ zpět
    pg.evaluate("__midiOutBy['nanoKONTROL Studio'].length = 0")
    send(NK, "[0x90, 47, 127]"); send(NK, "[0x90, 47, 0]")
    check("MCU: Bank ▶ = Banka 2", wait_for(lambda: "Banka 2" in pg.locator("#midiChip").inner_text()), pg.locator("#midiChip").inner_text())
    check("MCU: po bance všechny LED znovu (MUTE 1–8, SELECT 1–8)", wait_for(lambda: sum(1 for m in out(NK) if m[0] == 0x90 and 16 <= m[1] <= 31) >= 16), len(out(NK)))
    ch9 = pg.evaluate("MixtetHubSim.strips()[8].fader")
    v9 = pg.evaluate(f"MixtetHubSim.known('{ch9}')")
    send(NK, pb(0, v9)); send(NK, pb(0, 0.3))
    check("MCU: fader 1 v bance 2 = 9. pás", wait_for(lambda: abs(pg.evaluate(f"MixtetHubSim.known('{ch9}')") - 0.3) < 0.002), ch9)
    send(NK, "[0x90, 46, 127]"); send(NK, "[0x90, 46, 0]")
    check("MCU: Bank ◀ = Banka 1", wait_for(lambda: "Banka 1: Kick" in pg.locator("#midiChip").inner_text()))
    check("MCU: nanoKONTROL nemá motory ani displej – žádný Pitch Bend ani SysEx ven",
          not any(m[0] & 0xF0 == 0xE0 or m[0] == 0xF0 for m in out(NK)), [m for m in out(NK) if m[0] != 0x90][:5])

    # neznámý vstup: první Pitch Bend = Mackie Control (bez profilu)
    send(BLE, "[0x90, 60, 100]")
    check("MCU: neznámý vstup – nota bez Pitch Bend nic nezapne", "BLE MIDI Device" not in pg.locator("#midiChip").inner_text())
    send(BLE, pb(1, 0.01))
    check("MCU: neznámý vstup – auto-detekce z Pitch Bend", wait_for(lambda: "BLE MIDI Device (DAW / Mackie)" in pg.locator("#midiChip").inner_text()),
          pg.locator("#midiChip").inner_text())

    # motorový ovladač (podle jména): motor jede za pultem, echo vlastního tahu ho nerozkmitá, LCD jen se SysEx
    m = pg.evaluate("""async () => { const hub = MixtetHubSim, sent = [], ev = [];
      const e = MixtetMIDI.createEngine({hub, profile: MixtetMIDI.mcuProfile('X-Touch INT', true), mode: 'mcu', sysex: true,
        output: {send: b => sent.push(Array.from(b))}, on: x => ev.push(x.type)});
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const pbs = () => sent.filter(b => b[0] === 0xE0);
      const start = {pb: pbs().length, lcd: sent.filter(b => b[0] === 0xF0).map(b => b.slice(0, 6)), master: sent.some(b => b[0] === 0xE8)};
      sent.length = 0;
      e.handle([0x90, 104, 127]); const raw = Math.round(0.6 * 16383); e.handle([0xE0, raw & 0x7F, raw >> 7]); e.handle([0x90, 104, 0]);
      await wait(250);
      const afterEcho = pbs().length, moved = hub.known('/ch/01/mix/fader');
      hub.write('/ch/01/mix/fader', 0.2, 'tablet'); await wait(250);
      const scene = pbs();
      return {start, moved, afterEcho, scene, expect: MixtetMIDI.MCU.fader(0, hub.known('/ch/01/mix/fader')), ev}; }""")
    check("MCU motor: po připojení motory na místo + LCD SysEx", m["start"]["pb"] >= 1 and m["start"]["master"]
          and m["start"]["lcd"] == [[0xF0, 0, 0, 0x66, 0x14, 0x12]], m["start"])
    check("MCU motor: fader bez pickupu zapíše hned", abs(m["moved"] - 614 / 1023) < 1e-6, m["moved"])
    check("MCU motor: echo vlastního tahu motor nerozkmitá", m["afterEcho"] == 0, m)
    check("MCU motor: změna odjinud (iPad) pohne motorem", len(m["scene"]) == 1 and m["scene"][0] == m["expect"], m)
    check("konzole bez chyb (MCU)", not errors, errors[:5])
    ctx.close()

    # ---------------------------------------------------------------- desktop EN
    ctx = b.new_context(viewport={"width": 1440, "height": 900}, locale="en-US")
    pg = ctx.new_page()
    errors = []
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(BASE + "/demo/")
    tab, ph = ready(pg)
    check("EN: mobil anglicky", wait_for(lambda: "Mute my mix" in ph.locator("#bMute").inner_text()))
    ipad_screens(pg, tab, ph, "en")
    check("EN: iPad anglicky (TALK TO BAND, Live actions)", tab.locator("#talk").inner_text() == "TALK TO BAND (hold)" and "live actions" in tab.locator(".side").inner_text().lower())
    check("EN: Mac snímky s anglickým popiskem", "Every channel" in pg.locator("#pane-mac").text_content())
    check("EN: kanály ukázkové kapely anglicky", "Vox Adam" in ph.locator("body").inner_text() or "Vox Adam" in tab.locator("body").inner_text())
    pg.wait_for_timeout(1500)
    pg.screenshot(path=f"{SHOTS}/desktop-1440-en.png")
    with pg.expect_navigation():
        pg.locator("[data-signup]").first.click()
    check("EN: CTA vede na /#signup", pg.url.endswith("/#signup"), pg.url)
    check("admin: signup_click", "signup_click <b>" in admin())
    check("konzole bez chyb (EN)", not errors, errors[:5])
    ctx.close()

    # ---------------------------------------------------------------- mobil 375 × 812, Safari bez Web MIDI
    ctx = b.new_context(viewport={"width": 375, "height": 812}, locale="cs-CZ", has_touch=True, is_mobile=True)
    ctx.add_init_script("delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;")
    pg = ctx.new_page()
    errors = []
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(BASE + "/demo/cs/")
    tab, ph = ready(pg)
    check("375: záložky viditelné", pg.locator(".tabs").is_visible())
    check("375: tři záložky iPad / Mac / Mobil", all(pg.locator(x).is_visible() for x in ["#tab-tablet", "#tab-mac", "#tab-phone"]))
    check("375: iPad skrytý, mobil vidět", not pg.locator("#pane-tablet").is_visible() and pg.locator("#pane-phone").is_visible())
    check("375: bez vodorovného posunu stránky", pg.evaluate("document.documentElement.scrollWidth <= innerWidth"),
          pg.evaluate("[document.documentElement.scrollWidth, innerWidth]"))
    small = pg.evaluate("""() => [...document.querySelectorAll('body *')].filter(e => e.offsetParent && e.childNodes.length && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
      .map(e => parseFloat(getComputedStyle(e).fontSize)).filter(s => s < 11).length""")
    check("375: nic pod 11 px", small == 0, small)
    targets = pg.evaluate("""() => [...document.querySelectorAll('button, .tabs button, .pick')].filter(e => e.offsetParent)
      .map(e => e.getBoundingClientRect()).filter(r => r.height < 44).length""")
    check("375: tlačítka ≥ 44 px", targets == 0, targets)
    pg.locator("#stage").scroll_into_view_if_needed()
    pg.wait_for_timeout(1500)
    pg.screenshot(path=f"{SHOTS}/phone-375-tab-mobil.png")
    pg.locator("#tab-tablet").click()
    check("375: záložka iPad ukáže iPad", pg.locator("#pane-tablet").is_visible() and not pg.locator("#pane-phone").is_visible())
    pg.wait_for_timeout(400)
    pg.screenshot(path=f"{SHOTS}/phone-375-tab-ipad.png")
    check("375: iPad 1:1 (1180 px) s posunem do strany, stránka se neposouvá", tab.evaluate("innerWidth") == 1180
          and pg.evaluate("document.documentElement.scrollWidth <= innerWidth"), [tab.evaluate("innerWidth"), pg.evaluate("document.documentElement.scrollWidth")])
    pg.locator("#tab-mac").click()
    check("375: záložka Mac ukáže snímky", pg.locator("#macGallery").is_visible() and not pg.locator("#pane-phone").is_visible())
    pg.locator("#macNext").click()
    check("375: Mac šipka funguje, bez vodorovného posunu", pg.locator("#macCount").inner_text() == "2 z 6"
          and pg.evaluate("document.documentElement.scrollWidth <= innerWidth"), pg.evaluate("[document.documentElement.scrollWidth, innerWidth]"))
    pg.screenshot(path=f"{SHOTS}/phone-375-tab-mac.png")
    pg.locator("#tab-phone").click()
    pg.locator("#midi").click()
    check("Safari (bez Web MIDI): hláška Chrome / Edge", wait_for(lambda: "Chrome nebo Edge" in pg.locator("#status").inner_text(), 2))
    check("konzole bez chyb (375)", not errors, errors[:5])
    ctx.close()
    b.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} OK")
sys.exit(1 if failed else 0)
