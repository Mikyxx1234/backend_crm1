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

APP_MODE="${APP_MODE:-api}"
echo "[entrypoint] APP_MODE=${APP_MODE}"

# Migrations Prisma: rodam APENAS em APP_MODE=api. Workers no mesmo deploy
# (worker-whatsapp, worker-leads) sobem em paralelo à API e podem ter race
# condition se também tentarem aplicar migrations — basta um serviço aplicar.
# Por isso o branch abaixo é restrito a APP_MODE=api.
if [ "$APP_MODE" = "api" ]; then
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
else
  echo "[entrypoint] APP_MODE=${APP_MODE} — pulando migrations (somente API roda migrate)."
fi

# Roteamento APP_MODE → processo a iniciar.
#
# - api              → Next.js standalone server (comportamento histórico)
# - worker-whatsapp  → worker BullMQ que consome campaign-dispatch + campaign-send
#                      (script único: src/workers/campaign-worker.ts; sem reescrever
#                      lógica de envio Meta)
# - worker-leads     → worker BullMQ que consome leads-bulk
#                      (operações em massa de Deals com BulkOperation tracking)
#
# Workers são compilados via esbuild (npm run build:workers) e copiados para
# /app/dist/workers no Dockerfile runner stage. Executar com `node` direto.
case "$APP_MODE" in
  api)
    echo "[entrypoint] starting Next.js standalone server..."
    exec node server.js
    ;;
  worker-whatsapp)
    echo "[entrypoint] starting WhatsApp worker (campaign-worker)..."
    exec node dist/workers/campaign-worker.js
    ;;
  worker-leads)
    echo "[entrypoint] starting Leads worker..."
    exec node dist/workers/leads-worker.js
    ;;
  *)
    echo "[entrypoint] !! ERRO: APP_MODE='${APP_MODE}' não reconhecido."
    echo "[entrypoint] !! Valores válidos: api | worker-whatsapp | worker-leads"
    exit 1
    ;;
esac
