#!/bin/sh
set -e
cd /app

STORAGE_DIR="${STORAGE_ROOT:-/app/storage}"

# Fase 1 — root: conserta ownership de /app/storage e re-executa como
# nextjs via gosu. Isso resolve o caso em que o EasyPanel cria o volume
# (Docker named volume) como root-owned. Sem isso, o processo nextjs
# (UID 1001) recebe EACCES ao gravar mídia inbound do WhatsApp e o
# saveFile() falha silenciosamente.
#
# Re-execução: gosu troca o euid pra nextjs:nodejs e volta a executar
# este mesmo script. Na segunda passada o `id -u` já não é 0 e o bloco
# abaixo é pulado.
if [ "$(id -u)" = "0" ]; then
  echo "[entrypoint] root: ajustando ownership de $STORAGE_DIR (uid=1001 nextjs)"
  mkdir -p "$STORAGE_DIR" 2>/dev/null || true
  chown -R nextjs:nodejs "$STORAGE_DIR" 2>/dev/null || \
    echo "[entrypoint] !! aviso: chown $STORAGE_DIR falhou (sistema readonly?)"
  chmod -R u+rwX,g+rwX "$STORAGE_DIR" 2>/dev/null || true
  exec gosu nextjs:nodejs "$0" "$@"
fi

echo "[entrypoint] iniciando backend CRM ($(date -u +'%Y-%m-%dT%H:%M:%SZ')) — user=$(id -un) uid=$(id -u)"

# Smoke test: confirma que $STORAGE_DIR está gravável depois do drop.
if touch "$STORAGE_DIR/.write-test" 2>/dev/null; then
  rm -f "$STORAGE_DIR/.write-test"
  echo "[entrypoint] storage OK — gravável em $STORAGE_DIR"
else
  echo "[entrypoint] !! ERRO: $STORAGE_DIR NÃO É GRAVÁVEL pelo user $(id -un)."
  echo "[entrypoint] !! Mídia inbound do WhatsApp vai falhar silenciosamente."
  echo "[entrypoint] !! Verifique se gosu chown rodou na fase root acima."
fi

if [ -n "${SKIP_PRISMA_MIGRATE}" ]; then
  echo "[entrypoint] SKIP_PRISMA_MIGRATE set — pulando migrate deploy."
elif [ -z "${DATABASE_URL}" ]; then
  echo "[entrypoint] DATABASE_URL vazio — pulando migrate deploy."
else
  echo "[entrypoint] prisma migrate deploy..."
  if ! node /opt/prisma-cli/node_modules/prisma/build/index.js \
        migrate deploy --schema=prisma/schema.prisma; then
    echo "[entrypoint] migrate deploy falhou — tentando aplicar migrations
            manualmente via 'db execute' nos arquivos .sql..."
    # Fallback defensivo: aplica cada migration.sql na ordem. Idempotente
    # porque os scripts usam IF NOT EXISTS / DO blocks.
    for f in prisma/migrations/*/migration.sql; do
      echo "[entrypoint]   aplicando $f"
      node /opt/prisma-cli/node_modules/prisma/build/index.js \
        db execute --schema=prisma/schema.prisma --file "$f" || \
        echo "[entrypoint]   (warning) falha aplicando $f, prosseguindo"
    done
  fi
fi

echo "[entrypoint] starting Next.js standalone server..."
exec node server.js
