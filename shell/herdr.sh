# Abre herdr-app asegurando que la clave SSH esté cargada en el agente.
herdr-app() {
    if [ $# -eq 0 ]; then
        ssh-add -l >/dev/null 2>&1 || ssh-add ~/.ssh/id_ed25519
    fi
    command herdr-app "$@"
}
