#!/usr/bin/env bash
# Copia la config actual de esta máquina al repo (para después hacer commit/push).
set -euo pipefail
REPO="$(cd "$(dirname "$0")" && pwd)"
APP="${XDG_CONFIG_HOME:-$HOME/.config}/herdr-app"
CORE="${XDG_CONFIG_HOME:-$HOME/.config}/herdr"
cd "$APP"
cp settings.json keys.json shared.json installed.json "$REPO/herdr-app/"
rsync -a --delete --exclude='*.d.ts' --exclude='runtime.json' themes layouts mods "$REPO/herdr-app/"
cp "$CORE/config.toml" "$REPO/herdr/"
rsync -a --delete "$CORE/plugins/config/" "$REPO/herdr/plugins-config/"
cd "$REPO" && git status --short
echo "Revisá los cambios y: git commit -am 'sync' && git push"
