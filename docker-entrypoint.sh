#!/bin/sh
set -e
cd /app

echo "[entrypoint] iniciando backend CRM ($(date -u +'%Y-%m-%dT%H:%M:%SZ'))"

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
