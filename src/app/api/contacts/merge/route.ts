import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth-helpers";
import { getLogger } from "@/lib/logger";
import { mergeContacts } from "@/services/merge-contacts";

const log = getLogger("api.contacts.merge");

/**
 * POST /api/contacts/merge
 *
 * Funde dois contatos preservando o histórico do `keepId` e migrando o
 * que dá do `removeId` (conversas, deals, atividades, notas, tags,
 * campos personalizados, recipients de campanha, eventos de chamada,
 * agendamentos, logs de troca de número). O contato `removeId` é
 * deletado ao final.
 *
 * Restrito a ADMIN — merge é destrutivo (deleta uma row em `contacts`)
 * e exige confirmação visual prévia do operador.
 *
 * Caso de uso comum: a Meta entregou um `user_changed_number` tarde, e
 * o webhook acabou criando dois leads pra mesma pessoa. O admin abre
 * os dois lados, confirma que é o mesmo cliente e roda o merge.
 */

const BodySchema = z.object({
  keepId: z.string().min(1),
  removeId: z.string().min(1),
});

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let payload: z.infer<typeof BodySchema>;
  try {
    const raw = await request.json();
    payload = BodySchema.parse(raw);
  } catch (err) {
    return NextResponse.json(
      {
        message: "Payload inválido. Esperado { keepId, removeId }.",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    );
  }

  try {
    const res = await mergeContacts(payload.keepId, payload.removeId);
    if (!res.ok) {
      const messages: Record<typeof res.error.kind, string> = {
        same_id: "keepId e removeId devem ser diferentes.",
        keep_not_found: "Contato `keepId` não encontrado.",
        remove_not_found: "Contato `removeId` não encontrado.",
      };
      return NextResponse.json(
        { message: messages[res.error.kind] },
        { status: res.error.kind === "same_id" ? 400 : 404 },
      );
    }

    log.info(
      `Merge de contatos concluído: ${payload.removeId} → ${payload.keepId} por ${auth.session.user.email}`,
      res.result.moved,
    );
    return NextResponse.json({ ok: true, ...res.result });
  } catch (err) {
    log.error("Falha ao mesclar contatos:", err);
    return NextResponse.json(
      {
        message: "Erro ao mesclar contatos.",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
