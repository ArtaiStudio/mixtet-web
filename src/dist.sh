#!/bin/bash
# Postaví stránky a složí složku dist/ k nahrání do Cloudflare Pages (bez src/).
# Ukázka /demo/: src/demo_build.py převezme member.html, fullmix.html, tokeny a profily ovladačů z repa appky
# (MIXTET_REPO, výchozí ../mixing-app); bez repa použije dřív vygenerované kopie v demo/.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 src/build.py
python3 src/demo_build.py
rm -rf dist && mkdir dist
cp -R index.html cs feedback demo img video site.css site.js _worker.js _headers robots.txt sitemap.xml privacy.html ochrana-udaju.html dist/
# Aktualizace Mac appky (Sparkle): release/appcast.xml → /appcast.xml, release/download/* → /download/
if [ -f release/appcast.xml ]; then cp release/appcast.xml dist/; fi
if compgen -G "release/download/*" > /dev/null; then mkdir -p dist/download && cp release/download/* dist/download/; fi
find dist -type f | wc -l
