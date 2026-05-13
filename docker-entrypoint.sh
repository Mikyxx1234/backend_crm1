#!/bin/sh
set -e
cd /app

if [ -n "${SKIP_PRISMA_MIGRATE}" ]; then
  echo "[entrypoint] SKIP_PRISMA_MIGRATE set — pulando migrate deploy."
elif [ -z "${DATABASE_URL}" ]; then
  echo "[entrypoint] DATABASE_URL vazio — pulando migrate deploy."
else
  echo "[entrypoint] prisma migrate deploy..."
  node node_modules/prisma/build/index.js migrate deploy --schema=prisma/schema.prisma
fi

exec node server.js
