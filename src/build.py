#!/usr/bin/env python3
"""Postaví statický web mixtet.live: / (EN) a /cs/ (CZ) z jedné šablony + texts.py.
Spuštění: python3 src/build.py  (z kořene webu). Obrázky snímků čeká v img/screens/<jméno>.webp."""
import hashlib, html, json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from texts import T

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://mixtet.live"
e = html.escape


def ver(name):
    """Krátký otisk souboru do ?v= – nová verze CSS/JS se načte hned, ne až po vypršení cache."""
    with open(os.path.join(ROOT, name), "rb") as f:
        return hashlib.sha1(f.read()).hexdigest()[:8]


def has_img(name):
    return os.path.exists(os.path.join(ROOT, "img", "screens", name + ".webp"))


def img_size(name):
    from PIL import Image
    with Image.open(os.path.join(ROOT, "img", "screens", name + ".webp")) as im:
        return im.size


def page(lang):
    t = T[lang]
    other = "en" if lang == "cs" else "cs"
    base = "/cs/" if lang == "cs" else "/"
    obase = "/" if lang == "cs" else "/cs/"
    pre = "../" if lang == "cs" else ""
    priv = "/ochrana-udaju.html" if lang == "cs" else "/privacy.html"

    def li(items, cls=""):
        return "".join(f'<li{cls}>{e(x)}</li>' for x in items)

    prob = "".join(f'<div class="card quote"><p class="q">{e(a)}</p><p>{e(b)}</p></div>' for a, b in t["prob"])
    how = "".join(f'<li><span class="n">{i+1}</span><div><h3>{e(a)}</h3><p>{e(b)}</p></div></li>'
                  for i, (a, b) in enumerate(t["how"]))
    shots = []
    for i, (name, h, p) in enumerate(t["screens"]):
        if has_img(name):
            w, hh = img_size(name)
            pic = (f'<button class="shot" type="button" data-full="{pre}img/screens/{name}.webp" aria-label="{e(h)} – {"zvětšit" if lang == "cs" else "enlarge"}">'
                   f'<img src="{pre}img/screens/{name}.webp" width="{w}" height="{hh}" alt="{e(h)}" loading="lazy" decoding="async"></button>')
        else:
            pic = ''
        cls = (" wide" if i == 0 or w / hh > 2 else "") if pic else " noimg card"
        shots.append(f'<figure class="scr{cls}">{pic}<figcaption><h3>{e(h)}</h3><p>{e(p)}</p></figcaption></figure>')
    shots = "".join(shots)
    easy = "".join(f'<li><h3>{e(a)}</h3><p>{e(b)}</p></li>' for a, b in t["easy"])
    cols = t["cmpCols"]
    thead = "".join(f'<th scope="col"{" class=me" if i == 1 else ""}>{e(c)}</th>' for i, c in enumerate(cols))
    tbody = "".join("<tr>" + f'<th scope="row">{e(r[0])}</th>' +
                    "".join(f'<td{" class=me" if i == 0 else ""}>{e(c)}</td>' for i, c in enumerate(r[1:])) + "</tr>"
                    for r in t["cmp"])
    need = "".join(f'<li><h3>{e(a)}</h3><p>{e(b)}</p></li>' for a, b in t["need"])
    steps = "".join(f'<li><span class="n">{i+1}</span><div><h3>{e(a)}</h3><p>{e(b)}</p></div></li>'
                    for i, (a, b) in enumerate(t["steps"]))
    road = "".join(f'<li><b>{e(a)}</b><span>{e(b)}</span></li>' for a, b in t["road"])
    faq = "".join(f'<details><summary>{e(q)}</summary><p>{e(a)}</p></details>' for q, a in t["faq"])
    proof = "".join(f'<li>{e(x)}</li>' for x in t["proof"])

    def chips(name, opts, kind="radio"):
        return "".join(f'<label class="chip"><input type="{kind}" name="{name}" value="{v}"><span>{e(lbl)}</span></label>'
                       for v, lbl in opts)

    mixers = chips("mixer", [("xr18", "XR18"), ("xr16", "XR16"), ("xr12", "XR12"), ("mr18", "MR18"), ("x32", "X32 / M32"), ("other", t["oOther"])])
    langs = "".join(f'<label class="chip"><input type="radio" name="app_lang" value="{v}"{" checked" if v == lang else ""}><span>{e(n)}</span></label>'
                    for v, n in [("cs", "Čeština"), ("en", "English"), ("de", "Deutsch"), ("es", "Español"), ("pl", "Polski"), ("fr", "Français"), ("it", "Italiano"), ("other", t["oLangOther"])])
    hubs = chips("hub", [("mac", "Mac"), ("ipad", "iPad"), ("windows", "Windows"), ("android", t["oAndroid"]), ("unsure", t["oUnsure"])], "checkbox")
    members = chips("members", [(v, v) for v in ["2", "3", "4", "5", "6", "7+"]])
    iem = chips("iem", [("yes", t["oYes"]), ("planning", t["oPlanning"]), ("no", t["oNo"])])
    hero_img = ""
    if has_img("web-mixer"):
        w, hh = img_size("web-mixer")
        hero_img = f'<img class="mac" src="{pre}img/screens/web-mixer.webp" width="{w}" height="{hh}" alt="{e(t["heroAlt"])}" fetchpriority="high">'
    msgs = {k: t[k] for k in ["eEmail", "eMixer", "eConsent", "eServer", "okH", "okP", "okShare", "okCopied", "fSubmit", "fSending"]}

    return f"""<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{e(t["title"])}</title>
<meta name="description" content="{e(t["desc"])}">
<link rel="canonical" href="{SITE}{base}">
<link rel="alternate" hreflang="en" href="{SITE}/">
<link rel="alternate" hreflang="cs" href="{SITE}/cs/">
<link rel="alternate" hreflang="x-default" href="{SITE}/">
<meta property="og:type" content="website">
<meta property="og:url" content="{SITE}{base}">
<meta property="og:title" content="{e(t["title"])}">
<meta property="og:description" content="{e(t["desc"])}">
<meta property="og:image" content="{SITE}/img/og-{lang}.png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:locale" content="{"cs_CZ" if lang == "cs" else "en_US"}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0C1014">
<link rel="icon" type="image/png" href="{pre}img/znacka.png">
<link rel="stylesheet" href="{pre}site.css?v={ver('site.css')}">
</head>
<body>
<a class="skip" href="#main">{e(t["skip"])}</a>
<header class="top"><div class="wrap bar">
  <a class="brand" href="{base}"><img src="{pre}img/znacka.png" width="28" height="28" alt="">Mixtet</a>
  <nav aria-label="Main"><a href="#how">{e(t["navHow"])}</a><a href="#leader">{e(t["navLeader"])}</a><a href="#compare">{e(t["navCompare"])}</a><a href="#beta">{e(t["navBeta"])}</a></nav>
  <div class="right">
    <div class="lang" role="group" aria-label="Jazyk / Language">
      <a href="/cs/" data-lang="cs" hreflang="cs"{' aria-current="true"' if lang == "cs" else ""}>CZ</a><a href="/" data-lang="en" hreflang="en"{' aria-current="true"' if lang == "en" else ""}>EN</a>
    </div>
    <a class="btn sm" href="#join">{e(t["navCta"])}</a>
  </div>
</div></header>

<main id="main">
<section class="hero"><div class="wrap">
  <div class="hero-text">
    <p class="eyebrow">{e(t["eyebrow"])}</p>
    <h1>{t["h1"]}</h1>
    <p class="lead">{e(t["lead"])}</p>
    <div class="cta-row"><a class="btn" href="#join">{e(t["cta"])}</a><a class="btn ghost" href="#video">{e(t["cta2"])}</a></div>
    <ul class="proof">{proof}</ul>
    <p class="works">{e(t["works"])}</p>
  </div>
  <div class="hero-vis{" solo" if not hero_img else ""}">
    {hero_img}
    <div class="phone"><img src="{pre}img/phone-{lang}.webp" width="390" height="845" alt="{e(t["phoneAlt"])}"></div>
  </div>
</div></section>

<section class="sec" id="video"><div class="wrap">
  <h2>{e(t["vidH"])}</h2>
  <p class="sub">{e(t["vidSub"])}</p>
  <div class="vid"><video controls playsinline preload="none" poster="{pre}video/poster-{lang}-16x9.webp" aria-label="{e(t["vidAlt"])}">
    <source src="{pre}video/mixtet-{lang}-9x16.mp4" type="video/mp4" media="(max-width: 600px)">
    <source src="{pre}video/mixtet-{lang}-16x9.mp4" type="video/mp4">
  </video></div>
</div></section>

<section class="sec" id="problem"><div class="wrap">
  <h2>{e(t["probH"])}</h2>
  <div class="grid3">{prob}</div>
</div></section>

<section class="sec" id="how"><div class="wrap split">
  <div>
    <h2>{e(t["howH"])}</h2>
    <p class="sub">{e(t["howSub"])}</p>
    <ol class="steps">{how}</ol>
  </div>
  <div class="phone side"><img src="{pre}img/phone-{lang}.webp" width="390" height="845" alt="{e(t["phoneAlt"])}" loading="lazy"></div>
</div></section>

<section class="sec" id="leader"><div class="wrap">
  <h2>{e(t["leaderH"])}</h2>
  <p class="sub">{e(t["leaderSub"])}</p>
  <div class="shots">{shots}</div>
  {f'<p class="note">{e(t["shotNote"])}</p>' if has_img("web-mixer") else ""}
</div></section>

<section class="sec" id="easy"><div class="wrap">
  <h2>{e(t["easyH"])}</h2>
  <p class="sub">{e(t["easySub"])}</p>
  <ul class="easy">{easy}</ul>
  <div class="mid"><div><p class="mid-h">{e(t["midH"])}</p><p>{e(t["midSub"])}</p></div><a class="btn" href="#join">{e(t["cta"])}</a></div>
</div></section>

<section class="sec" id="compare"><div class="wrap">
  <h2>{e(t["cmpH"])}</h2>
  <div class="tbl" tabindex="0" role="region" aria-label="{e(t["cmpH"])}"><table><thead><tr>{thead}</tr></thead><tbody>{tbody}</tbody></table></div>
  <p class="note">{e(t["cmpNote"])}</p>
</div></section>

<section class="sec" id="need"><div class="wrap">
  <h2>{e(t["needH"])}</h2>
  <ul class="need">{need}</ul>
  <div class="diabox">{diagram(t)}</div>
</div></section>

<section class="sec" id="beta"><div class="wrap beta">
  <div class="beta-info">
    <p class="eyebrow">{e(t["betaEyebrow"])}</p>
    <p class="big"><span>50</span> {e(t["bigLabel"])}</p>
    <h2>{e(t["betaH"])}</h2>
    <ol class="steps">{steps}</ol>
    <ul class="terms">{li(t["terms"])}</ul>
    <h3 class="road-h">{e(t["roadH"])}</h3>
    <ul class="road">{road}</ul>
  </div>
  <div class="formcol" id="join">
    <form id="signup" class="card form" novalidate>
      <h2 class="form-h">{e(t["formH"])}</h2>
      <div class="f">
        <label for="email">{e(t["fEmail"])}</label>
        <input id="email" name="email" type="email" autocomplete="email" required aria-describedby="email-hint email-err" inputmode="email">
        <p class="hint" id="email-hint">{e(t["fEmailHint"])}</p><p class="err" id="email-err" hidden></p>
      </div>
      <fieldset class="f" aria-describedby="mixer-err"><legend>{e(t["fMixer"])}</legend><div class="chips">{mixers}</div><p class="err" id="mixer-err" hidden></p></fieldset>
      <fieldset class="f"><legend>{e(t["fHub"])} <span class="opt">{e(t["fHubHint"])}</span></legend><div class="chips">{hubs}</div></fieldset>
      <div class="f2">
        <fieldset class="f"><legend>{e(t["fMembers"])}</legend><div class="chips">{members}</div></fieldset>
        <fieldset class="f"><legend>{e(t["fIem"])}</legend><div class="chips">{iem}</div></fieldset>
      </div>
      <fieldset class="f"><legend>{e(t["fAppLang"])}</legend><div class="chips">{langs}</div></fieldset>
      <details class="more"><summary>{e(t["fMore"])}</summary>
        <div class="f2">
          <div class="f"><label for="band">{e(t["fBand"])}</label><input id="band" name="band" autocomplete="organization" maxlength="80"></div>
          <div class="f"><label for="country">{e(t["fCountry"])}</label><input id="country" name="country" autocomplete="country-name" maxlength="60"></div>
        </div>
        <div class="f"><label for="note">{e(t["fNote"])}</label><textarea id="note" name="note" rows="3" maxlength="1000"></textarea></div>
      </details>
      <div class="hp" aria-hidden="true"><label>Web <input name="web" tabindex="-1" autocomplete="off"></label></div>
      <label class="consent"><input type="checkbox" name="consent" id="consent" aria-describedby="consent-err"><span>{e(t["fConsent"])}</span></label>
      <p class="err" id="consent-err" hidden></p>
      <button class="btn full" type="submit" id="submit">{e(t["fSubmit"])}</button>
      <p class="err" id="server-err" role="alert" hidden></p>
      <p class="note">{e(t["fPriv"])} <a href="{priv}">{e(t["privL"])}</a></p>
    </form>
    <div class="card done" id="done" hidden tabindex="-1"><h2></h2><p></p><button class="btn ghost" type="button" id="share"></button></div>
  </div>
</div></section>

<section class="sec" id="faq"><div class="wrap narrow">
  <h2>{e(t["faqH"])}</h2>
  <div class="faq">{faq}</div>
</div></section>

<section class="sec" id="about"><div class="wrap narrow about">
  <img src="{pre}img/logo.png" width="160" height="164" alt="Mixtet" loading="lazy">
  <div><h2>{e(t["aboutH"])}</h2><p>{t["about"]}</p></div>
</div></section>
</main>

<footer><div class="wrap"><p>{e(t["foot"])}</p><p><a href="{priv}">{e(t["privL"])}</a></p></div></footer>
<div class="sticky" id="sticky" hidden><a class="btn full" href="#join">{e(t["stickyCta"])}</a></div>
<dialog id="zoom"><form method="dialog"><button class="x" aria-label="Zavřít / Close">×</button></form><img alt=""></dialog>
<script>window.MIXTET={json.dumps({"lang": lang, "msg": msgs}, ensure_ascii=False)};</script>
<script src="{pre}site.js?v={ver('site.js')}" defer></script>
</body>
</html>
"""


def diagram(t):
    g = lambda k: e(t[k])
    phones = ""
    for i, y in enumerate([40, 150, 260]):
        c = ["--m1", "--m2", "--m3"][i]
        phones += (f'<g class="ph"><rect x="70" y="{y}" width="50" height="84" rx="9"/><rect x="77" y="{y+9}" width="36" height="9" rx="2" style="fill:var({c})"/>'
                   f'<line x1="79" y1="{y+34}" x2="111" y2="{y+34}"/><line x1="79" y1="{y+50}" x2="111" y2="{y+50}"/>'
                   f'<rect class="k" x="94" y="{y+29}" width="7" height="10" rx="1"/><rect class="k" x="85" y="{y+45}" width="7" height="10" rx="1"/></g>')
    return f"""<svg class="dia" viewBox="0 0 960 420" role="img" aria-labelledby="diaT"><title id="diaT">{g("diaAlt")}</title>
<path class="w" d="M120 82 C230 82 250 102 330 102"/><path class="w" d="M120 192 C230 192 250 102 330 102"/><path class="w" d="M120 302 C240 302 250 102 330 102"/>
<line class="c" x1="430" y1="144" x2="430" y2="250"/><line class="c" x1="530" y1="102" x2="700" y2="102"/><line class="a" x1="810" y1="144" x2="810" y2="250"/><line class="c o" x1="430" y1="344" x2="430" y2="364"/>
<text class="l" x="200" y="150">{g("dWifi")}</text><text class="l" x="442" y="202">{g("dLanWifi")}</text><text class="l" x="615" y="92" text-anchor="middle">{g("dLan")}</text><text class="l" x="822" y="202">{g("dAudio")}</text>
{phones}
<text class="t" x="40" y="388">{g("dPhones")}</text><text class="s" x="40" y="408">{g("dPhonesSub")}</text>
<g class="nd"><rect x="330" y="60" width="200" height="84" rx="12"/><text class="t" x="346" y="94">{g("dRouter")}</text><text class="s" x="346" y="118">{g("dRouterSub")}</text></g>
<g class="nd"><rect x="330" y="250" width="200" height="94" rx="12"/><text class="t" x="346" y="284">{g("dMac")}</text><text class="s" x="346" y="308">{g("dMacSub")}</text></g>
<g class="nd"><rect x="700" y="60" width="220" height="84" rx="12"/><text class="t" x="716" y="94">{g("dMixer")}</text><text class="s" x="716" y="118">{g("dMixerSub")}</text></g>
<g class="nd"><rect x="700" y="250" width="220" height="94" rx="12"/><text class="t" x="716" y="284">{g("dIem")}</text><text class="s" x="716" y="308">{g("dIemSub")}</text></g>
<g class="nd o"><rect x="335" y="364" width="190" height="36" rx="18"/><text class="s" x="430" y="387" text-anchor="middle">{g("dMidi")}</text></g>
</svg>"""


if __name__ == "__main__":
    open(os.path.join(ROOT, "index.html"), "w").write(page("en"))
    os.makedirs(os.path.join(ROOT, "cs"), exist_ok=True)
    open(os.path.join(ROOT, "cs", "index.html"), "w").write(page("cs"))
    print("ok: index.html, cs/index.html")
