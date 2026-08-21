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

# ── Modo embedded (iframe dentro do CRM) ─────────────────────────────────
# Ambas as envs são OPCIONAIS. Sem COCKPIT_PARENT_ORIGINS o serviço se comporta
# exatamente como antes (standalone, sem frame-ancestors) e o modo embedded
# fica desligado — o index.html mostra um aviso em vez de aceitar handshake de
# uma origem que não pode validar.
PARENT_ORIGINS_CSV="${COCKPIT_PARENT_ORIGINS:-}"
ALLOWED_API_BASES_CSV="${COCKPIT_ALLOWED_API_BASES:-}"

# Quebra CSV em linhas, remove espaços/barras finais e descarta qualquer
# entrada fora do formato de origem. Isso é o que impede um valor malformado
# de env de virar injeção no config.js (JS) ou no nginx.conf.
sanitize_origins() {
  echo "$1" \
    | tr ',' '\n' \
    | sed 's/^[[:space:]]*//; s/[[:space:]]*$//; s:/*$::' \
    | grep -E '^https?://(\*\.)?[A-Za-z0-9._-]+(:[0-9]+)?$' || true
}

FRAME_ANCESTORS=""
JS_PARENT_ORIGINS=""
CORS_MAP_ENTRIES=""
for origin in $(sanitize_origins "$PARENT_ORIGINS_CSV"); do
  # `frame-ancestors` aceita curinga de subdomínio nativamente.
  FRAME_ANCESTORS="$FRAME_ANCESTORS $origin"
  JS_PARENT_ORIGINS="$JS_PARENT_ORIGINS\"$origin\","
  case "$origin" in
    *://\*.*)
      # nginx `map` não faz curinga: vira regex com os pontos escapados.
      scheme="$(echo "$origin" | sed -E 's~^(https?)://.*~\1~')"
      suffix="$(echo "$origin" | sed -E 's~^https?://\*\.~~' | sed 's/\./\\./g')"
      CORS_MAP_ENTRIES="$CORS_MAP_ENTRIES
  \"~^${scheme}://[A-Za-z0-9-]+\\.${suffix}\$\" \$http_origin;"
      ;;
    *)
      CORS_MAP_ENTRIES="$CORS_MAP_ENTRIES
  \"${origin}\" \"${origin}\";"
      ;;
  esac
done

JS_API_BASES=""
for base in $(sanitize_origins "$ALLOWED_API_BASES_CSV"); do
  JS_API_BASES="$JS_API_BASES\"$base\","
done

JS_PARENT_ORIGINS="$(echo "$JS_PARENT_ORIGINS" | sed 's/,$//')"
JS_API_BASES="$(echo "$JS_API_BASES" | sed 's/,$//')"

# `add_header` em um location substitui os herdados, então o CSP precisa ser
# repetido em cada location que serve o documento HTML.
CSP_HEADER=""
if [ -n "$FRAME_ANCESTORS" ]; then
  CSP_HEADER="add_header Content-Security-Policy \"frame-ancestors 'self'${FRAME_ANCESTORS}\" always;"
fi

cat > /etc/nginx/conf.d/default.conf <<NGINX
# Origem permitida a ler /nav.json. Vazio => nenhum header CORS é emitido
# (nginx omite add_header com valor vazio). Nunca usamos "*".
map \$http_origin \$cockpit_cors_origin {
  default "";${CORS_MAP_ENTRIES}
}

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
    ${CSP_HEADER}
  }

  location = /config.js {
    add_header Cache-Control "no-store";
  }

  location = /nav.json {
    default_type application/json;
    add_header Access-Control-Allow-Origin \$cockpit_cors_origin always;
    add_header Vary Origin always;
    add_header Cache-Control "no-store" always;
  }

  location = /index.html {
    add_header Cache-Control "no-store";
    ${CSP_HEADER}
  }
}
NGINX

cat > /usr/share/nginx/html/config.js <<EOF
window.COCKPIT_CONFIG = {
  apiBase: "${API_BASE}",
  accessSecret: "${ACCESS_SECRET}",
  allowedParentOrigins: [${JS_PARENT_ORIGINS}],
  allowedApiBases: [${JS_API_BASES}],
  urls: {
    backend: { prod: "${BACKEND_PROD_URL}" },
    frontend: { prod: "${FRONTEND_PROD_URL}" }
  }
};
EOF

exec nginx -g 'daemon off;'
