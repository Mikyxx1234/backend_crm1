import { prisma } from "@/lib/prisma";

/**
 * Fallback inteligente: quando o `Contact.avatarUrl` é `null` (caso
 * comum porque o webhook do WhatsApp ainda não baixa a foto de perfil
 * do cliente), tentamos descobrir uma foto plausível via match exato
 * de nome com algum `User` do CRM.
 *
 * Cenário típico: agente/admin testando como cliente — manda mensagem
 * do próprio número pro número da empresa. O `Contact` é criado só com
 * `name + phone`. Como o nome do contato bate exatamente com o nome
 * do `User` agente (mesma pessoa), faz sentido visualmente reaproveitar
 * a foto de perfil do User como avatar do Contact até que a foto real
 * do WhatsApp seja baixada (ver TODO no webhook).
 *
 * ⚠️ É um fallback PURAMENTE VISUAL. Não atribui ownership, não
 * vincula o Contact ao User no banco. Só preenche `avatarUrl` em
 * memória pra renderização. Em caso de homônimos (dois contatos com
 * mesmo nome de algum agente), todos vão herdar a mesma foto — é uma
 * concessão consciente, e raríssima na prática.
 *
 * Performance: faz UMA query consolidada `IN (...)` independente do
 * número de contatos, evitando N+1.
 */
export async function enrichContactsWithUserAvatarFallback<
  T extends { name: string | null | undefined; avatarUrl?: string | null },
>(contacts: T[]): Promise<void> {
  // Coleta nomes únicos dos contatos SEM avatarUrl. Trim + lowercase pra
  // bater independente de casing / espaços extras.
  const namesNeedingFallback = new Set<string>();
  for (const c of contacts) {
    if (c.avatarUrl) continue;
    const n = (c.name ?? "").trim();
    if (n) namesNeedingFallback.add(n.toLowerCase());
  }

  if (namesNeedingFallback.size === 0) return;

  // Busca usuários ativos com nome compatível. `mode: "insensitive"`
  // do Prisma resolve case na própria query — mas como `name` no
  // schema não tem índice insensitive, fazemos o filtro final em JS
  // após a query (com IN no nome cru pra reduzir o universo).
  const users = await prisma.user.findMany({
    where: {
      avatarUrl: { not: null },
      // Sem `OR` com lista de nomes (variações de case difíceis no
      // banco) — pegamos todos os ativos com avatar e filtramos em JS.
      // Em produção raramente passa de algumas dezenas de agentes,
      // então é barato.
    },
    select: { name: true, avatarUrl: true },
  });

  // Mapa nome-normalizado → primeira avatarUrl encontrada.
  const map = new Map<string, string>();
  for (const u of users) {
    if (!u.name || !u.avatarUrl) continue;
    const key = u.name.trim().toLowerCase();
    if (!key) continue;
    if (!namesNeedingFallback.has(key)) continue;
    if (!map.has(key)) map.set(key, u.avatarUrl);
  }

  if (map.size === 0) return;

  // Aplica em-memória nos contatos sem avatar.
  for (const c of contacts) {
    if (c.avatarUrl) continue;
    const key = (c.name ?? "").trim().toLowerCase();
    const fallback = map.get(key);
    if (fallback) {
      c.avatarUrl = fallback;
    }
  }
}
