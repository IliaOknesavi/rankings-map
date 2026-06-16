#!/usr/bin/env bash
# Ручной деплой: собрать и опубликовать dist/ в ветку gh-pages (GitHub Pages).
# Используется, пока не включён CI-автодеплой (нужен scope `workflow`).
set -euo pipefail
cd "$(dirname "$0")"

npm run build

tmp="$(mktemp -d)"
cp -R dist/. "$tmp/"
touch "$tmp/.nojekyll"
cd "$tmp"
git init -q
git checkout -q -b gh-pages
git add -A
git -c commit.gpgsign=false commit -qm "deploy: $(date -u +%Y-%m-%dT%H:%MZ)"
git push -f https://github.com/IliaOknesavi/rankings-map.git gh-pages

echo "Deployed → https://iliaoknesavi.github.io/rankings-map/"
