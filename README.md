# mixtet.live – web Mixtetu

Statický web na **Cloudflare Pages** (projekt `mixtet`, doména mixtet.live) s workerem `_worker.js`
(přesměrování jazyka, formulář bety → D1 `mixtet`, zpětná vazba, `/admin`, počítadlo ukázky).
Appka je v repu `ArtaiStudio/mixing-app`.

## Struktura
- `src/build.py` + `src/texts.py` → `index.html` (EN) a `cs/index.html` (CZ)
- `src/demo_build.py` + `src/demo_texts.py` → ukázka `/demo/` (kopíruje `web/member.html`, `web/fullmix.html`,
  tokeny a profily ovladačů z repa appky; `MIXTET_REPO`, výchozí `../mixing-app`). Bez repa použije kopie v `demo/`.
  Build skončí chybou, když se do kopie dostane skutečné jméno člena KRAI.
- `demo/hub-sim.js`, `shim.js`, `midi.js`, `demo.js`, `demo.css` – ruční zdroje ukázky (simulovaný hub a pult, Web MIDI)
- `release/` – aktualizace Mac appky pro Sparkle: `release/appcast.xml` → `https://mixtet.live/appcast.xml`,
  `release/download/*.dmg` → `https://mixtet.live/download/`. Přidává je Mac session z `make release` (`dist/web/`)
  **jako PR**. Poznámky k vydání nesmí obsahovat skutečná jména kapely.
- `_headers` (CSP, bezpečnost), `robots.txt`, `sitemap.xml`, `privacy.html`, `ochrana-udaju.html`

## Build a nasazení
```
bash src/dist.sh                       # postaví dist/
cd dist && zip -qr ../../mixtet-web.zip .   # zip obsahu dist/ (soubory v kořeni)
```
Nasazení: Cloudflare › Workers & Pages › mixtet › Create deployment › nahrát zip (Production).
Tajemství (`ADMIN_KEY`) a vazba D1 `DB` jsou jen v Cloudflare, nikdy v repu.

## Testy ukázky
```
bash src/dist.sh && node src/tests/serve.mjs 8788 dist &
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers python3 src/tests/test_demo.py http://127.0.0.1:8788 /tmp/shots
```

## Pravidla
- Žádné externí zdroje (CSP), žádná analytika, jedna funkční cookie `mixtet-lang`.
- Na webu nejsou jména členů KRAI ani osobní kontakty (jen booking@krai.cz); Behringer / XR18 jen popisně.
- Logo jen ze skutečných souborů, nikdy generované.
