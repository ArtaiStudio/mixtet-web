#!/usr/bin/env python3
"""Postaví ukázku mixtet.live/demo/: /demo/ (EN) a /demo/cs/ (CZ) + kopie skutečných stránek Mixtetu.

Z repa appky (MIXTET_REPO, výchozí ../mixing-app) převezme web/member.html, web/fullmix.html a web/tokens.css,
vloží tokeny mezi /* @tokens:start */ a /* @tokens:end */ (stejně jako gen-tokens), jako PRVNÍ skript v <head>
vloží <script src="/demo/shim.js"> a značku /logo.png přesměruje na /demo/logo.png. Chování stránek se nemění.
Profily ovladačů (Sources/KRAIMixMIDI/profiles/*.json) jdou do demo/profiles/.
Spuštění z kořene webu: python3 src/demo_build.py   (bez repa appky nechá dřív vygenerované kopie, jak jsou)."""
import html, json, os, re, shutil, sys
sys.path.insert(0, os.path.dirname(__file__))
from demo_texts import D
from texts import T

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEMO = os.path.join(ROOT, "demo")
REPO = os.environ.get("MIXTET_REPO", os.path.join(ROOT, "..", "mixing-app"))
SITE = "https://mixtet.live"
e = html.escape

# Skutečná jména členů KRAI nesmí na web (ani v komentářích kódu) – ukázková kapela je Adam, Tom, Dan, Filip.
REAL_NAMES = re.compile(r"Martin|Štěpán|Stepan|Jirk|Jiří|Petr(?!o)", re.I)
COMMENT_FIX = {"Štěpána / Jirku / Petra": "Toma / Dana / Filipa"}
TOK_START, TOK_END = "/* @tokens:start */", "/* @tokens:end */"
SHIM = '<script src="/demo/shim.js"></script>'


def tokens_css():
    css = open(os.path.join(REPO, "web", "tokens.css"), encoding="utf-8").read()
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S).strip()   # komentáře tokenů nesou jména členů – pryč


def app_page(name, css):
    src = open(os.path.join(REPO, "web", name), encoding="utf-8").read()
    s, t = src.find(TOK_START), src.find(TOK_END)
    if s < 0 or t < 0:
        sys.exit(f"{name}: chybí značky tokenů")
    page = src[:s + len(TOK_START)] + "\n" + css + "\n" + src[t:]
    meta = '<meta charset="utf-8">'
    if meta not in page:
        sys.exit(f"{name}: chybí <meta charset> – nevím, kam vložit shim")
    page = page.replace(meta, meta + "\n" + SHIM + '\n<meta name="robots" content="noindex">', 1)
    page = page.replace('"/logo.png"', '"/demo/logo.png"').replace("'/logo.png'", "'/demo/logo.png'")
    for a, b in COMMENT_FIX.items():
        page = page.replace(a, b)
    bad = REAL_NAMES.findall(page)
    if bad:
        sys.exit(f"{name}: skutečná jména v kopii stránky: {sorted(set(bad))}")
    return "<!-- Vygenerováno src/demo_build.py z repa Mixtetu (web/" + name + ") – needitovat ručně. -->\n" + page


def copy_app():
    if not os.path.isdir(os.path.join(REPO, "web")):
        print(f"! repo Mixtetu nenalezeno ({REPO}) – kopie stránek nechávám, jak jsou")
        return False
    css = tokens_css()
    for name in ["member.html", "fullmix.html"]:
        open(os.path.join(DEMO, name), "w", encoding="utf-8").write(app_page(name, css))
    shutil.copyfile(os.path.join(ROOT, "img", "znacka.png"), os.path.join(DEMO, "logo.png"))
    pdir = os.path.join(REPO, "Sources", "KRAIMixMIDI", "profiles")
    out = os.path.join(DEMO, "profiles")
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(out)
    files = sorted(f for f in os.listdir(pdir) if f.endswith(".json"))
    for f in files:
        json.load(open(os.path.join(pdir, f), encoding="utf-8"))   # rozbitý profil = chyba buildu
        shutil.copyfile(os.path.join(pdir, f), os.path.join(out, f))
    json.dump(files, open(os.path.join(out, "index.json"), "w"), indent=0)
    return True


def img_size(name):
    from PIL import Image
    with Image.open(os.path.join(ROOT, "img", "screens", name + ".webp")) as im:
        return im.size


def mac_gallery(d):
    """Snímky Mac appky v okně macOS: šipky, tečky (≥ 44 px), klávesy ← →. Ukázková kapela, žádná skutečná jména."""
    slides, dots = "", ""
    shots = [x for x in d["macShots"] if os.path.exists(os.path.join(ROOT, "img", "screens", x[0] + ".webp"))]
    for i, (name, title, cap) in enumerate(shots):
        w, h = img_size(name)
        slides += (f'<figure class="mslide" data-title="{e(title)}"{"" if i == 0 else " hidden"}>'
                   f'<div class="mview"><img src="/img/screens/{name}.webp" width="{w}" height="{h}" alt="{e(title)} – {e(cap)}" '
                   f'loading="{"eager" if i == 0 else "lazy"}" decoding="async"></div>'
                   f'<figcaption><b>{e(title)}</b> {e(cap)}</figcaption></figure>')
        dots += (f'<button type="button" class="mdot" data-i="{i}" aria-pressed="{"true" if i == 0 else "false"}">'
                 f'{e(title)}</button>')
    n = len(shots)
    return (f'<div class="macwin" id="macGallery" role="region" aria-roledescription="carousel" aria-label="{e(d["macGallery"])}" tabindex="0" data-of="{e(d["macOf"])}">'
            f'<div class="mbar" aria-hidden="true"><span class="lights"><i></i><i></i><i></i></span><span class="mtitle" id="macTitle">Mixtet</span></div>'
            f'{slides}</div>'
            f'<div class="mnav"><button type="button" class="mbtn" id="macPrev" aria-label="{e(d["macPrev"])}">‹</button>'
            f'<span class="mcount" id="macCount" aria-live="polite">1 / {n}</span>'
            f'<button type="button" class="mbtn" id="macNext" aria-label="{e(d["macNext"])}">›</button></div>'
            f'<div class="mdots" role="group" aria-label="{e(d["macGallery"])}">{dots}</div>')


def page(lang):
    d, s = D[lang], T[lang]
    base = "/demo/cs/" if lang == "cs" else "/demo/"
    home = "/cs/" if lang == "cs" else "/"
    priv = "/ochrana-udaju.html" if lang == "cs" else "/privacy.html"
    signup = home + "#signup"
    members = "".join(f'<button type="button" class="pick" data-bus="{b}" aria-pressed="{"true" if b == 1 else "false"}">{n}</button>'
                      for b, n in [(1, "Adam"), (2, "Tom"), (3, "Dan"), (4, "Filip")])
    steps = "".join(
        f'<li class="step" id="step-{k}"><span class="mark" aria-hidden="true">{i}</span><div><p class="st-t">{e(d["t"]["tour" + k.upper()])} <span class="sr st-s"></span></p>'
        f'<p class="st-h">{e(d["t"]["tour" + k.upper() + "Hint"])}</p>'
        + (f'<button type="button" class="btn ghost sm" id="toTom">{e(d["t"]["tourASwitch"])}</button>' if k == "a" else "")
        + "</div></li>" for i, k in enumerate("abc", 1))
    miss = "".join(f"<li><h3>{e(a)}</h3><p>{e(b)}</p></li>" for a, b in d["miss"])
    shots = ""
    for name, cap in d["missShots"]:
        if os.path.exists(os.path.join(ROOT, "img", "screens", name + ".webp")):
            w, h = img_size(name)
            shots += f'<figure><img src="/img/screens/{name}.webp" width="{w}" height="{h}" alt="{e(cap)}" loading="lazy" decoding="async"><figcaption>{e(cap)}</figcaption></figure>'
    cfg = {"lang": lang, "signup": signup, "t": d["t"]}
    mac = mac_gallery(d)
    note = f'<p class="tnote">{e(d["tabletNote"])}</p>' if d["tabletNote"] else ""
    return f"""<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{e(d["title"])}</title>
<meta name="description" content="{e(d["desc"])}">
<link rel="canonical" href="{SITE}{base}">
<link rel="alternate" hreflang="en" href="{SITE}/demo/">
<link rel="alternate" hreflang="cs" href="{SITE}/demo/cs/">
<link rel="alternate" hreflang="x-default" href="{SITE}/demo/">
<meta property="og:type" content="website">
<meta property="og:url" content="{SITE}{base}">
<meta property="og:title" content="{e(d["title"])}">
<meta property="og:description" content="{e(d["desc"])}">
<meta property="og:image" content="{SITE}/img/og-{lang}.png">
<meta name="theme-color" content="#0C1014">
<link rel="icon" type="image/png" href="/img/znacka.png">
<link rel="stylesheet" href="/site.css">
<link rel="stylesheet" href="/demo/demo.css">
<script>window.MIXTET_DEMO={json.dumps(cfg, ensure_ascii=False)};</script>
<script src="/demo/hub-sim.js"></script>
<script src="/demo/midi.js"></script>
<script src="/demo/demo.js" defer></script>
</head>
<body class="demo">
<a class="skip" href="#stage">{e(s["skip"])}</a>
<header class="top"><div class="wrap wide bar">
  <a class="brand" href="{home}"><img src="/img/znacka.png" width="28" height="28" alt="">Mixtet</a>
  <span class="dtag">Demo</span>
  <div class="right">
    <div class="lang" role="group" aria-label="Jazyk / Language">
      <a href="/demo/cs/" data-lang="cs" hreflang="cs"{' aria-current="true"' if lang == "cs" else ""}>CZ</a><a href="/demo/" data-lang="en" hreflang="en"{' aria-current="true"' if lang == "en" else ""}>EN</a>
    </div>
    <a class="btn sm" href="{signup}" data-signup>{e(d["navCta"])}</a>
  </div>
</div></header>

<main id="main">
<section class="dhero"><div class="wrap wide">
  <p class="eyebrow">{e(d["eyebrow"])}</p>
  <h1>{e(d["h1"])}</h1>
  <p class="lead">{e(d["lead"])}</p>
  <p class="badge"><span aria-hidden="true">◌</span> {e(d["badge"])}</p>
</div></section>

<section class="tour" id="tour" aria-labelledby="tourH"><div class="wrap wide">
  <div class="tour-head"><h2 id="tourH">{e(d["tourH"])}</h2>
    <button type="button" class="btn ghost sm" id="tourToggle" aria-expanded="true" aria-controls="tourBody" data-hide="{e(d["tourHide"])}" data-show="{e(d["tourShow"])}">{e(d["tourHide"])}</button></div>
  <div id="tourBody">
    <ol class="steps3">{steps}</ol>
    <div class="tour-done" id="tourDone" hidden><p>{e(d["t"]["tourDone"])}</p><a class="btn" href="{signup}" data-signup>{e(d["cta"])}</a></div>
  </div>
  <p class="sr" id="tourLive" role="status" aria-live="polite"></p>
</div></section>

<div class="wrap wide">
  <div class="toolbar" role="toolbar" aria-label="Ukázka / Demo">
    <div class="picker" role="group" aria-labelledby="pickL"><span id="pickL">{e(d["pickL"])}</span>{members}</div>
    <button type="button" class="btn ghost sm" id="outage">{e(d["outage"])}</button>
    <button type="button" class="btn ghost sm" id="midi">{e(d["midiBtn"])}</button>
    <button type="button" class="btn ghost sm" id="reset">{e(d["reset"])}</button>
  </div>
  <p class="status" id="status" role="status" aria-live="polite"></p>
  <p class="midichip" id="midiChip" hidden></p>

  <div class="tabs" role="tablist" aria-label="{e(d["tabsL"])}">
    <button type="button" role="tab" id="tab-tablet" aria-controls="pane-tablet" aria-selected="true">{e(d["tabTablet"])}</button>
    <button type="button" role="tab" id="tab-mac" aria-controls="pane-mac" aria-selected="false" tabindex="-1">{e(d["tabMac"])}</button>
    <button type="button" role="tab" id="tab-phone" aria-controls="pane-phone" aria-selected="false" tabindex="-1">{e(d["tabPhone"])}</button>
  </div>
  <div class="stage" id="stage" tabindex="-1">
    <div class="left">
    <section class="dev dev-tablet" id="pane-tablet" role="tabpanel" aria-labelledby="tab-tablet">
      <div class="cap"><h2>{e(d["tabletH"])}</h2><p>{e(d["tabletSub"])}</p>{note}</div>
      <div class="bezel ipad"><div class="scroller" id="ipadFit"><div class="sizer" id="ipadSizer"><iframe id="fTablet" title="{e(d["tabletFrame"])}" loading="eager"></iframe></div></div></div>
      <p class="hint-scroll">{e(d["tabletScroll"])}</p>
    </section>
    <section class="dev dev-mac inactive" id="pane-mac" role="tabpanel" aria-labelledby="tab-mac">
      <div class="cap"><h2>{e(d["macH"])}</h2><p class="tnote">{e(d["macSub"])}</p></div>
      {mac}
    </section>
    </div>
    <section class="dev dev-phone" id="pane-phone" role="tabpanel" aria-labelledby="tab-phone">
      <div class="cap"><h2 id="phoneH">{e(d["phoneH"])}</h2><p>{e(d["phoneSub"])}</p></div>
      <div class="bezel iphone"><iframe id="fPhone" title="{e(d["phoneFrame"])}" loading="eager"></iframe></div>
    </section>
  </div>
  <noscript><p class="status">{e(d["noscript"])}</p></noscript>
  <p class="simnote">{e(d["simNote"])}</p>
  <details class="mididbg" id="midiDbg" hidden><summary>{e(d["midiDebug"])}</summary><pre id="midiLog"></pre></details>
</div>

<section class="sec" id="missing"><div class="wrap wide">
  <h2>{e(d["missH"])}</h2>
  <p class="sub">{e(d["missSub"])}</p>
  <ul class="miss">{miss}</ul>
  <div class="mshots">{shots}</div>
  <div class="mid"><div><p class="mid-h">{e(d["ctaH"])}</p><p>{e(d["ctaP"])}</p></div><a class="btn" href="{signup}" data-signup>{e(d["cta"])}</a></div>
</div></section>
</main>

<footer><div class="wrap wide"><p>{e(s["foot"])}</p><p><a href="{home}">{e(d["back"])}</a> · <a href="{priv}">{e(s["privL"])}</a></p></div></footer>

<button type="button" class="fbbtn" id="fbOpen" aria-haspopup="dialog" aria-label="{e(d["fbBtn"])}"><span class="fbt">{e(d["fbBtn"])}</span><span class="fbq" aria-hidden="true">?</span></button>
<dialog id="fb" aria-labelledby="fbH">
  <form id="fbForm" class="card form" novalidate>
    <h2 id="fbH" class="form-h">{e(d["fbH"])}</h2>
    <p class="hint">{e(d["fbP"])}</p>
    <div class="f"><label for="fbMsg">{e(d["fbMsg"])}</label><textarea id="fbMsg" name="message" rows="4" maxlength="3000" required></textarea></div>
    <div class="f"><label for="fbEmail">{e(d["fbEmail"])}</label><input id="fbEmail" name="email" type="email" autocomplete="email" inputmode="email"></div>
    <div class="hp" aria-hidden="true"><label>Web <input name="web" tabindex="-1" autocomplete="off"></label></div>
    <p class="err" id="fbErr" role="alert" hidden></p>
    <p class="okmsg" id="fbOk" role="status" hidden></p>
    <div class="fbacts"><button class="btn" type="submit" id="fbSend">{e(d["fbSend"])}</button><button class="btn ghost" type="button" id="fbClose">{e(d["fbClose"])}</button></div>
  </form>
</dialog>
</body>
</html>
"""


if __name__ == "__main__":
    copied = copy_app()
    open(os.path.join(DEMO, "index.html"), "w", encoding="utf-8").write(page("en"))
    os.makedirs(os.path.join(DEMO, "cs"), exist_ok=True)
    open(os.path.join(DEMO, "cs", "index.html"), "w", encoding="utf-8").write(page("cs"))
    print("ok: demo/index.html, demo/cs/index.html" + (", member.html, fullmix.html, profiles/" if copied else ""))
