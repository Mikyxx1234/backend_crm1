/**
 * PATCH /api/profile/preferences/sidebar — DEPRECATED (14/jul/26).
 *
 * A personalizacao da sidebar deixou de ser per-user e virou config de
 * Papel (Role), editavel apenas por admin em /settings/permissions. Ver
 * `AGENT.md` (entry "Sidebar por Papel") e `services/user-preferences.ts`
 * (`saveRoleSidebarItems` / `getSidebarPreferences`).
 *
 * A rota continua existindo apenas para responder um erro claro caso
 * algum cliente antigo (ex.: mobile app cached, worker) tente escrever
 * — evita 404 silencioso. Ela retorna 410 Gone com uma mensagem
 * amigavel; o frontend v2 nao chama mais.
 */

import { NextResponse } from "next/server";

export function PATCH() {
  return NextResponse.json(
    {
      message:
        "A personalização da sidebar agora é configurada por Papel em /settings/permissions. Peça ao admin da organização para ajustar.",
      code: "SIDEBAR_MOVED_TO_ROLE",
    },
    { status: 410 },
  );
}
