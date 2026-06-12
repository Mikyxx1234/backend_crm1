# Plano: Atribuição Canal → Funil (roteamento de origem)

Status: **planejado — aguardando liberação do backend** — 2026-06-12
Agente: OPUS (decisão de arquitetura)
Contexto: pergunta do usuário sobre como o CRM trata atribuição de canal a funil
e permissões por canal, comparando dois paradigmas de CRMs concorrentes.

> ⚠️ Este documento descreve **por que** e **o que** fazer. O código **não** foi
> implementado: a parte 1 (schema) exige migração de banco no backend, hoje
> bloqueada por restrição operacional ("não subir commit do backend agora").

---

## Os dois paradigmas (origem da dúvida)

O usuário trouxe screenshots de dois CRMs que tratam o tema de formas distintas:

1. **Atendentes → conexões** (ex.: Chatwoot/Kommo "limitar acesso do atendente
   para conexões específicas"): controle de **acesso** — quem pode ver/usar cada
   canal.
2. **Fonte → Funil** (ex.: Kommo "fontes de lead" por etapa/funil): controle de
   **destino** — lead que entra pelo canal X cai no funil Y.

São eixos ortogonais (acesso vs. roteamento), podem coexistir.

## Situação atual (investigação 2026-06-12)

### ✅ Paradigma 1 (permissão por agente por canal) — JÁ EXISTE

- Escopo por usuário **e por grupo**, separando **ver** e **enviar** por canal.
  - Tipos/lógica: `src/lib/authz/scope-grants-shared.ts`
    (`canAccessChannelForUser`, `listAllowedChannelIdsForUser`,
    `channel.view.users[userId]`, `channel.send.users[userId]`).
  - Persistência: `OrganizationSetting` key `permissions.scope.grants.v1`
    (`src/lib/authz/scope-grants.ts`).
  - Aplicação efetiva no acesso a conversas: `src/lib/conversation-access.ts`
    (filtra `channelId in allowedChannelIds`).
  - UI: `frontend/src/features/permissions/user-permissions-view.tsx`
    ("Canais — ver mensagens" / "Canais — enviar mensagens").
- Escopo por **funil** por usuário/grupo também existe (`pipeline.users[userId]`).

### ❌ Paradigma 2 (Canal → Funil) — NÃO EXISTE

- `model Channel` (`prisma/schema.prisma`) **não tem `pipelineId`**.
- Todo inbound cria o deal no pipeline `isDefault` (fallback: mais antigo),
  **ignorando o canal de origem**:
  `src/services/auto-deals.ts` → `ensureOpenDealForContact`
  (`prisma.pipeline.findFirst({ orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] })`).
- Regras de distribuição (`DistributionRule`) já são **por pipeline**, mas não
  têm filtro por canal — a escolha do pipeline acontece antes (no auto-deals).

### Resposta direta ao cenário do usuário (2 canais)

| Necessidade | Hoje |
|---|---|
| Permissões diferentes de quem **vê/usa** cada canal | ✅ já dá (usuário e grupo, ver/enviar separados) |
| Canal A → Funil X e Canal B → Funil Y | ❌ não dá — tudo cai no funil default |

---

## Decisão / plano de implementação (Canal → Funil)

Mudança **aditiva**, sem quebra de contrato, compondo com distribuição (que já é
por pipeline). 3 partes:

### Parte 1 — Schema (backend, exige migração)

- `Channel.pipelineId String?` + relação `pipeline Pipeline? @relation(...)`
  (onDelete: `SetNull`).
- `Pipeline` ganha o back-relation `channels Channel[]`.
- Migração aditiva (coluna nullable). Sem backfill: `null` = comportamento atual
  (cai no default).

### Parte 2 — Roteamento (backend)

- `ensureOpenDealForContact` passa a aceitar `channelId?` (já disponível no
  inbound — `Conversation.channelId`).
- Seleção de pipeline:
  1. se o canal tem `pipelineId` setado e o pipeline existe → usa ele;
  2. senão → fallback atual (`isDefault` → mais antigo).
- Chamadores a ajustar: handlers de inbound (Meta webhook, Baileys
  message-handler) passam o `channelId` da conversa.
- Distribuição (`getNextOwner(pipelineId)`) continua igual — agora recebe o
  pipeline correto por consequência.

### Parte 3 — UI (frontend)

- Seletor "Funil de destino" no card/edição do canal em `/channels`
  (default: "Funil padrão"). Persistido via rota de canal existente
  (`config`/campo dedicado) — sem nova rota.

## Consequências / pendências

- **Bloqueio atual:** Parte 1 (coluna nova) precisa de migração → aguardar
  liberação do backend. UI (Parte 3) sem a coluna não persiste; não adianta
  fazer isolada.
- Sem regressão: canais sem `pipelineId` mantêm exatamente o fluxo de hoje.
- Eixo de acesso (paradigma 1) permanece independente: um agente pode ter o
  canal roteado para o funil X e ainda assim só ver/enviar nos canais que lhe
  forem concedidos.

## Alternativas consideradas

- **Roteamento via DistributionRule (config por canal)** em vez de coluna no
  Channel: descartado por ora — a escolha do pipeline acontece no auto-deals,
  antes da distribuição; colocar a regra no Channel é mais direto e visível para
  o operador na própria tela de canais.
- **`config` Json do Channel** em vez de coluna tipada: possível para evitar
  migração, mas perde integridade referencial (FK/SetNull) e indexação; preferir
  coluna quando o backend liberar.
