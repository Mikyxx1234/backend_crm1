# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY prisma ./prisma
RUN npm install

COPY . .
# Pasta `public` pode não existir no clone (vazia não vai pro Git); o runner precisa dela.
RUN mkdir -p public
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# User `nextjs` sem HOME quebra `npx`/npm cache; Prisma CLI usa HOME em runtime.
ENV HOME=/tmp
ENV NPM_CONFIG_CACHE=/tmp/.npm

RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
# Runtime: engines + client (standalone já traz parte do @prisma; isto completa).
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
# CLI: não copiar só `node_modules/prisma` — `@prisma/config` exige `effect`, `c12`, … hoistados.
ARG PRISMA_VERSION=6.19.3
RUN mkdir -p /opt/prisma-cli \
  && cd /opt/prisma-cli \
  && npm install prisma@${PRISMA_VERSION} --omit=dev --no-audit --no-fund \
  && chown -R nextjs:nodejs /opt/prisma-cli

COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh \
  && mkdir -p /tmp/.npm \
  && chown -R nextjs:nodejs /tmp

USER nextjs
EXPOSE 3000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
