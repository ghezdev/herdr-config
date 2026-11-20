#!/usr/bin/env bash
# Copia la config actual de esta máquina al repo (para después hacer commit/push).
set -euo pipefail
REPO="$(cd "$(dirname "$0")" && pwd)"
APP="${XDG_CONFIG_HOME:-$HOME/.config}/herdr-app"
CORE="${XDG_CONFIG_HOME:-$HOME/.config}/herdr"
cd "$APP"
cp settings.json keys.json installed.json "$REPO/herdr-app/"
# shared.json sin el estado interno de gitview (rutas de repos, ids de tabs de esta máquina).
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); json.dump({k:v for k,v in d.items() if not k.startswith("gitview.")}, open(sys.argv[2],"w"), ensure_ascii=False, separators=(",",":"))' shared.json "$REPO/herdr-app/shared.json"
# gitview (mods/gitview*) lo instala install.sh con su instalador: trae un binario
# compilado y un config.json con rutas de esta máquina.
rsync -a --delete --exclude='*.d.ts' --exclude='runtime.json' --exclude='/mods/gitview*' --exclude='.cache' themes layouts mods "$REPO/herdr-app/"
cp "$CORE/config.toml" "$REPO/herdr/"
rsync -a --delete "$CORE/plugins/config/" "$REPO/herdr/plugins-config/"
# Plugin de OpenCode que reporta su estado a herdr-app (OSC 7501).
mkdir -p "$REPO/opencode/plugins"
cp "${XDG_CONFIG_HOME:-$HOME/.config}/opencode/plugins/hc-agent-status.js" "$REPO/opencode/plugins/"
cd "$REPO" && git status --short
echo "Revisá los cambios y: git commit -am 'sync' && git push"
