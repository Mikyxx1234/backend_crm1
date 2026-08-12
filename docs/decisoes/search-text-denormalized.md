# ADR — Coluna de busca desnormalizada (`search_text` / tsvector)

**Status:** proposta (não implementada neste PR)  
**Data:** 2026-08-11  
**Contexto:** inbox/board com `ILIKE %q%` em várias colunas + custom fields; mesmo após 1 JOIN em `contacts` e índices `pg_trgm`, a busca ainda é OR multi-coluna e não escala com volume de Cruzeiro.

## Decisão proposta

Adicionar coluna de busca materializada:

| Tabela | Coluna | Conteúdo |
|--------|--------|----------|
| `deals` | `search_text` `text` (ou `tsvector`) | title + contact name/email/phone + custom field values do deal/contato |
| `conversations` | `search_text` | inboxName + contact fields + assignedTo name/email + deal titles do contato |

Indexar com GIN (`gin_trgm_ops` se `text` + ILIKE, ou GIN tsvector se full-text).

Manutenção:

1. **Trigger** `AFTER INSERT/UPDATE` em `deals`, `contacts`, `*_custom_field_values`, `conversations`, `users` (nome do assignee) — recalcula só a linha afetada.
2. Ou **job** periódico (mais simples, lag de segundos) — inadequado para inbox “ao digitar”.

Predicado da API vira um único:

```sql
WHERE search_text ILIKE '%' || $q || '%'
-- ou: WHERE search_vector @@ plainto_tsquery('portuguese', $q)
```

## Por que não neste PR

- Reescrever o shape Prisma do OR → 1 join já reduz JOINs duplicados **sem migration** e é semanticamente idêntico (baixo risco).
- `search_text` exige backfill em tabelas grandes (`deals` ~476 MB, `contacts` ~159 MB), triggers em hot path de webhook/campanha, e testes de consistência — risco operacional alto sob carga atual.
- tsvector muda ranking/semântica (tokenização) vs `contains` atual — precisa aceite de produto.

## Critério para implementar

1. Após debounce front + cap sendRate estáveis em prod.
2. EXPLAIN da busca (já com 1 join + trgm) ainda > ~200 ms p95 sob carga normal.
3. Janela de manutenção para backfill CONCURRENTLY + validação amostral.

## Alternativa descartada agora

- Extensão `pg_search` / OpenSearch externo — overkill para o CRM atual.
- Só `tsvector` em `deals.title` — não cobre telefone/RGM/custom fields que o usuário espera.
