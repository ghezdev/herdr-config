#!/usr/bin/env bash
# Aplica esta configuración de herdr / herdr-app en la máquina actual.
# Hace backup de lo que ya exista en ~/.config/herdr-config-backup-<fecha>.
set -euo pipefail
REPO="$(cd "$(dirname "$0")" && pwd)"
APP="${XDG_CONFIG_HOME:-$HOME/.config}/herdr-app"
CORE="${XDG_CONFIG_HOME:-$HOME/.config}/herdr"
BACKUP="${XDG_CONFIG_HOME:-$HOME/.config}/herdr-config-backup-$(date +%Y%m%d-%H%M%S)"

backup() { [ -e "$1" ] && mkdir -p "$BACKUP/$2" && cp -a "$1" "$BACKUP/$2/" || true; }

echo "==> herdr-app -> $APP"
mkdir -p "$APP"
for f in settings.json keys.json shared.json installed.json themes layouts mods; do
  backup "$APP/$f" herdr-app
done
cp -a "$REPO/herdr-app/." "$APP/"

echo "==> herdr -> $CORE"
mkdir -p "$CORE/plugins/config"
backup "$CORE/config.toml" herdr
cp "$REPO/herdr/config.toml" "$CORE/config.toml"
cp -a "$REPO/herdr/plugins-config/." "$CORE/plugins/config/"

if command -v herdr >/dev/null 2>&1; then
  echo "==> plugins"
  herdr plugin install -y alexarthurs/herdr-sidebar/plugins/herdr-sidebar || echo "   (no se pudo instalar herdr-sidebar)"
  echo "==> integraciones con agentes (solo las que estén instaladas)"
  for a in claude codex pi opencode hermes; do
    if command -v "$a" >/dev/null 2>&1; then
      herdr integration install "$a" || echo "   (falló integración $a)"
    fi
  done
else
  echo "!! herdr no está instalado: instalalo (https://herdr.dev) y volvé a correr este script"
fi

echo "==> opencode: plugin que reporta su estado a herdr-app (Agents)"
OC_PLUGINS="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/plugins"
mkdir -p "$OC_PLUGINS"
cp "$REPO/opencode/plugins/hc-agent-status.js" "$OC_PLUGINS/"

echo "==> gitview (panel de Changes, menú Git ▾)"
# Su instalador baja el binario de la release (verificado con SHA-256), copia
# los mods gitview* y agrega sus atajos. Necesita herdr-app abierto.
if command -v herdr-app >/dev/null 2>&1 && herdr-app status >/dev/null 2>&1; then
  curl -fsSL https://raw.githubusercontent.com/ChmaraX/herdr-gitview/main/install.sh | sh -s -- --app ||
    echo "   (falló gitview; reintentá con herdr-app abierto)"
else
  echo "   herdr-app no está abierto: abrilo y corré"
  echo "   curl -fsSL https://raw.githubusercontent.com/ChmaraX/herdr-gitview/main/install.sh | sh -s -- --app"
fi

echo "==> shell"
LINE="[ -f \"$REPO/shell/herdr.sh\" ] && . \"$REPO/shell/herdr.sh\""
for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
  [ -f "$rc" ] && ! grep -qF "$REPO/shell/herdr.sh" "$rc" && echo "$LINE" >> "$rc" && echo "   agregado a $rc"
done

[ -d "$BACKUP" ] && echo "Backup de la config anterior: $BACKUP"
echo "Listo. Reiniciá herdr-app."
