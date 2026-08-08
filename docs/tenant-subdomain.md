# Tenant por subdomínio (Kommo-style)

URL canônica: `https://{slug}.crm.eduit.com.br`  
Apex/marketing: `https://crm.eduit.com.br`

## Env

| Onde | Variável | Default / notas |
|------|----------|-----------------|
| BE | `TENANT_BASE_DOMAIN` | `crm.eduit.com.br` |
| BE | `TENANT_PROTOCOL` | `https` |
| BE | `AUTH_COOKIE_DOMAIN` | em HTTPS → `.{TENANT_BASE_DOMAIN}`; `none` desliga |
| FE | `NEXT_PUBLIC_TENANT_BASE_DOMAIN` | `crm.eduit.com.br` |
| FE | `NEXT_PUBLIC_TENANT_PROTOCOL` | `https` |
| FE | `NEXTAUTH_URL` | apex (`https://crm.eduit.com.br`) |

Helpers: `buildTenantUrl(slug)` / `tenantUrl(slug)` (BE + FE).  
Signup (`POST /api/signup`) devolve `slug` + `tenantUrl`.

## DNS / EasyPanel / TLS (checklist)

1. **DNS wildcard** — registro `*.crm.eduit.com.br` (CNAME/A) apontando para o mesmo destino do apex `crm.eduit.com.br`.
2. **Apex** — `crm.eduit.com.br` → serviço frontend.
3. **TLS wildcard** — certificado `*.crm.eduit.com.br` (+ SAN do apex se necessário). No EasyPanel/Traefik: emitir/usar cert que cubra o wildcard; sem isso só o apex abre em HTTPS.
4. **Proxy** — Traefik/Caddy: Host `crm.eduit.com.br` e `*.crm.eduit.com.br` no mesmo router/serviço do frontend.
5. **Backend** — continua em host próprio (ex. `api.…`); o browser fala com o FE, que faz rewrite `/api/*`.
6. **Cookie** — em prod HTTPS o Auth.js seta `Domain=.crm.eduit.com.br` para a sessão sobreviver ao redirect pós-signup (apex → subdomínio).
7. **Reservados** (não são orgs): `www`, `app`, `api`, `crm`, `admin`, `static`, `assets`, `mail`, `status`, `localhost`.

## Dev local (sem wildcard DNS)

Browsers tratam `*.localhost` como loopback — não precisa de DNS.

Para o redirect pós-signup gerar `http://{slug}.localhost` (e o middleware
resolver o Host), use nos dois repos:

```env
# FE
NEXT_PUBLIC_TENANT_BASE_DOMAIN=localhost
NEXT_PUBLIC_TENANT_PROTOCOL=http
NEXTAUTH_URL=http://localhost:3000

# BE
TENANT_BASE_DOMAIN=localhost
TENANT_PROTOCOL=http
AUTH_COOKIE_DOMAIN=none
```

```bash
# Apex
http://localhost:3000

# Tenant
http://acme.localhost:3000
```

Override sem subdomain (útil em ferramentas que não aceitam `*.localhost`):

```http
x-tenant-slug: acme
```

Em local HTTP o cookie **não** usa `Domain` compartilhado. Após signup no
apex, o redirect para `{slug}.localhost` pode exigir um login extra no
tenant (cookie host-only). Em prod HTTPS com `AUTH_COOKIE_DOMAIN=.crm…`
a sessão segue no redirect.

## Comportamento

- Host com slug válido → cookie/header `tenant-slug` / `x-tenant-slug`; app liberado.
- Slug inválido → 404 amigável.
- Sessão JWT com `organizationSlug` ≠ Host (e não super-admin) → 403 / login com `tenant_mismatch`.
- Escopo Prisma/JWT por `organizationId` permanece; o slug só amarra o Host à sessão.
