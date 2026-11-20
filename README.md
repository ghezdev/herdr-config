# herdr-config

Mi configuración de [herdr](https://herdr.dev) y herdr-app: atajos, temas, layouts, mods, plugins e integraciones con agentes.

## Contenido

| Ruta | Destino | Qué es |
|---|---|---|
| `herdr-app/settings.json` | `~/.config/herdr-app/` | zoom, sonidos, apariencia |
| `herdr-app/keys.json` | `~/.config/herdr-app/` | atajos de teclado |
| `herdr-app/shared.json` | `~/.config/herdr-app/` | layout activo, menú de agentes |
| `herdr-app/installed.json` | `~/.config/herdr-app/` | hashes de los mods por defecto (para que las actualizaciones no pisen cambios) |
| `herdr-app/themes/` | `~/.config/herdr-app/themes/` | atom-one-dark, win98 |
| `herdr-app/layouts/` | `~/.config/herdr-app/layouts/` | main, main-tools, main-insights, terminals, win98 |
| `herdr-app/mods/` | `~/.config/herdr-app/mods/` | mods (git-graph, insights, recap, win98, worktree, …) |
| `herdr/config.toml` | `~/.config/herdr/` | config del core |
| `herdr/plugins-config/` | `~/.config/herdr/plugins/config/` | config de plugins (automations) |
| `opencode/plugins/hc-agent-status.js` | `~/.config/opencode/plugins/` | hace que las sesiones de OpenCode aparezcan en Agents de herdr-app (reporta su estado con OSC 7501) |
| `shell/herdr.sh` | se carga desde `.bashrc`/`.zshrc` | wrapper `herdr-app()` que carga la clave SSH |

`install.sh` además instala:
- el plugin `alexarthurs/herdr-sidebar`
- [gitview](https://github.com/ChmaraX/herdr-gitview) para herdr-app (con la app abierta): el panel de Changes y el menú **Git ▾** de la barra (Graph, Gitview: panel, Gitview: tab). Sus mods (`mods/gitview*`) no se guardan acá porque traen un binario compilado
- las integraciones de herdr para los agentes que tengas instalados (claude, codex, pi, opencode, hermes); esto genera los hooks en `~/.claude/hooks`, `~/.codex`, etc.

## Máquina nueva

1. Instalar herdr y herdr-app (https://herdr.dev).
2. ```sh
   git clone git@github.com:ghezdev/herdr-config.git ~/code/herdr-config
   ~/code/herdr-config/install.sh
   ```
3. Reiniciar herdr-app.

La config previa queda en `~/.config/herdr-config-backup-<fecha>/`.

## Guardar cambios

```sh
~/code/herdr-config/sync.sh
cd ~/code/herdr-config && git commit -am "sync" && git push
```

## Qué NO se guarda

Binarios, sockets, logs, telemetría, cachés, estado de sesión/ventana (`view.json`, `window.json`, `session.json`, `~/.local/state/herdr*`), datos de mods (`data/`) y los plugins clonados (se descargan de nuevo).
