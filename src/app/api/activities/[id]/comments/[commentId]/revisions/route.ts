import { NextResponse } from "next/server";

import { authenticateApiRequest, runWithApiUserContext } from "@/lib/api-auth";
import { getActivityById } from "@/services/activities";
import { listCommentRevisions } from "@/services/activity-comments";
import { canAccessActivity, type TaskViewer } from "@/services/task-visibility";

type RouteContext = { params: Promise<{ id: string; commentId: string }> };

function viewerFromAuth(user: {
  id: string;
  role?: string | null;
  organizationId?: string | null;
  isSuperAdmin?: boolean;
}): TaskViewer {
  return {
    id: user.id,
    organizationId: user.organizationId ?? null,
    role: user.role ?? null,
    isSuperAdmin: Boolean(user.isSuperAdmin),
  };
}

/**
 * Histórico imutável de um comentário (CREATED/UPDATED/DELETED).
 * Acesso: quem pode ver a Activity (ADMIN inclusive). Conteúdo de
 * revisões é exposto aqui mesmo após soft-delete.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const authResult = await authenticateApiRequest(request);
    if (!authResult.ok) return authResult.response;

    return await runWithApiUserContext(authResult.user, async () => {
      const { id, commentId } = await context.params;
      if (!id || !commentId) {
        return NextResponse.json({ message: "ID inválido." }, { status: 400 });
      }

      const activity = await getActivityById(id);
      if (!activity) {
        return NextResponse.json({ message: "Atividade não encontrada." }, { status: 404 });
      }
      if (!(await canAccessActivity(viewerFromAuth(authResult.user), activity))) {
        return NextResponse.json({ message: "Atividade não encontrada." }, { status: 404 });
      }

      try {
        const items = await listCommentRevisions({ activityId: id, commentId });
        return NextResponse.json({ items });
      } catch (err: unknown) {
        if (err instanceof Error && err.message === "NOT_FOUND") {
          return NextResponse.json({ message: "Comentário não encontrado." }, { status: 404 });
        }
        throw err;
      }
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: "Erro ao listar histórico." }, { status: 500 });
  }
}
