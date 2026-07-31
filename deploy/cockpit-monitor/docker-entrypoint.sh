#!/bin/sh
set -eu

ACCESS_SECRET="${COCKPIT_ACCESS_SECRET:-}"
BACKEND_PROD_URL="${BACKEND_PROD_URL:-${COCKPIT_API_BASE:-}}"
FRONTEND_PROD_URL="${FRONTEND_PROD_URL:-}"
# Porta em que o Nginx escuta. Default 80; ajuste (ex.: 8000) para casar com
# o mapeamento de domínio do EasyPanel sem precisar mexer no domínio.
LISTEN_PORT="${PORT:-80}"

if [ -z "$ACCESS_SECRET" ]; then
  echo "ERRO: defina COCKPIT_ACCESS_SECRET no EasyPanel." >&2
  exit 1
fi
if [ -z "$BACKEND_PROD_URL" ]; then
  echo "ERRO: defina BACKEND_PROD_URL ou COCKPIT_API_BASE." >&2
  exit 1
fi

strip_trail() { echo "$1" | sed 's:/*$::'; }
host_from() { echo "$1" | sed -E 's~https?://~~; s~/.*~~'; }

BACKEND_PROD_URL="$(strip_trail "$BACKEND_PROD_URL")"
FRONTEND_PROD_URL="$(strip_trail "$FRONTEND_PROD_URL")"
API_BASE="$BACKEND_PROD_URL"

BP_HOST="$(host_from "$BACKEND_PROD_URL")"

cat > /etc/nginx/conf.d/default.conf <<NGINX
server {
  listen ${LISTEN_PORT};
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  location = /proxy/prod/backend/health {
    proxy_pass ${BACKEND_PROD_URL}/api/health;
    proxy_ssl_server_name on;
    proxy_set_header Host ${BP_HOST};
    proxy_connect_timeout 5s;
    proxy_read_timeout 10s;
    add_header Cache-Control "no-store";
  }

  location / {
    try_files \$uri \$uri/ /index.html;
  }

  location = /config.js {
    add_header Cache-Control "no-store";
  }

  location = /index.html {
    add_header Cache-Control "no-store";
  }
}
NGINX

cat > /usr/share/nginx/html/config.js <<EOF
window.COCKPIT_CONFIG = {
  apiBase: "${API_BASE}",
  accessSecret: "${ACCESS_SECRET}",
  urls: {
    backend: { prod: "${BACKEND_PROD_URL}" },
    frontend: { prod: "${FRONTEND_PROD_URL}" }
  }
};
EOF

exec nginx -g 'daemon off;'
