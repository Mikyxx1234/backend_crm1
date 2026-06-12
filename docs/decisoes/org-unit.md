# Decisão: `OrgUnit` (unidade do tenant) vs reuso de "Groups"

Status: aceito — 2026-06-11
Contexto: domínio "Produtos multi-tipo" (oferta por unidade + pools por unidade).

## Problema

O domínio novo precisa de uma "unidade do tenant" (filial / CNPJ) para:

- `ProductOffer` (preço/desconto/condições por filial);
- `InventoryPool` (estoque/vagas/assentos por filial; pool global quando nulo).

O princípio 4 do prompt exige: **antes de criar model novo, investigar
`/api/groups` + `settings:groups`** e só criar `OrgUnit` se grupos não servirem,
documentando o porquê.

## Investigação

- **Não existe model Prisma `Group`.** A única rota é
  `src/app/api/groups/route.ts`, um stub: `GET` retorna `[]` e `POST` retorna
  `501` ("Grupos ainda não disponíveis nesta versão"). Não checa `settings:groups`
  (checa `settings:permissions`).
- A permissão `settings:groups` está no catálogo rotulada **"Grupos e filas
  (Fase 3)"**. `roles.ts` hardcoda contadores de grupos em zero.
- O contrato planejado no frontend (`features/permissions/types.ts`:
  `GroupSummary`, `GroupMember`) descreve **equipe/fila de atendimento RBAC**:
  N:N usuários ↔ grupo, `roleId`, `channelGrants`, `stageGrants`. Nada de
  endereço, CNPJ, hierarquia ou vínculo a deals/contatos por unidade.
- `Company` é **conta cliente B2B** (tem `address`, sem CNPJ, sem hierarquia até
  agora). `Organization` é o **tenant** (sem CNPJ/endereço fiscal).

## Decisão

Criar model novo **`OrgUnit`** (`org_units`): `name`, `legalName?`, `taxId?`
(CNPJ), `address?`, `active`, auto-relação `parentId` (matriz → filiais).
Manter `Group` reservado para equipes/RBAC (Fase 3) e `Company` para contas
clientes.

Mapa de conceitos:

| Conceito          | Model           | Papel                                  |
|-------------------|-----------------|----------------------------------------|
| Tenant (SaaS)     | `Organization`  | Conta do cliente EduIT (já existe)     |
| Filial / unidade  | `OrgUnit` (novo)| CNPJ, razão social, endereço, hierarquia |
| Conta cliente B2B | `Company`       | CRM B2B (já existe; ganhou `parentId`) |
| Equipe / fila     | `Group` (Fase 3)| Membros, role, grants operacionais     |

## Por que não reusar "Groups"

1. Implementação inexistente (stub) — reusar o nome confundiria equipe RBAC com
   unidade jurídica.
2. Semântica já reservada para Fase 3 (grupos de usuários + filas + grants de
   canal/etapa), alinhada a ReBAC, não a estrutura societária.
3. Domínio distinto de `Company` (empresa cliente) e de `Organization` (tenant).

## Consequências / pendências

- `ProductOffer.orgUnitId` é obrigatório (oferta sempre por unidade); ausência de
  offer para a unidade → cai no `Product.price` base.
- `InventoryPool.orgUnitId` é opcional (`null` = pool global do produto).
- Falta UI/rotas de CRUD de `OrgUnit` (entregue na Fase 2: `/api/org-units`).
- RBAC: adicionadas `org_unit:view` / `org_unit:manage`.
- Seed de unidade default por organização **não** é criado automaticamente; um
  tenant sem `OrgUnit` usa preço base e pools globais. Documentar no onboarding
  se/quando necessário.
