import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";

export async function getQuickReplies() {
  return prisma.quickReply.findMany({ orderBy: { position: "asc" } });
}

export async function getQuickReplyById(id: string) {
  return prisma.quickReply.findUnique({ where: { id } });
}

export async function createQuickReply(data: {
  title: string;
  content: string;
  category?: string;
}) {
  const maxPos = await prisma.quickReply.aggregate({ _max: { position: true } });
  return prisma.quickReply.create({
    data: withOrgFromCtx({
      title: data.title,
      content: data.content,
      category: data.category ?? null,
      position: (maxPos._max.position ?? -1) + 1,
    }),
  });
}

export async function updateQuickReply(
  id: string,
  data: { title?: string; content?: string; category?: string; position?: number }
) {
  return prisma.quickReply.update({ where: { id }, data });
}

export async function deleteQuickReply(id: string) {
  return prisma.quickReply.delete({ where: { id } });
}

export async function reorderQuickReplies(orderedIds: string[]) {
  const ops = orderedIds.map((id, idx) =>
    prisma.quickReply.update({ where: { id }, data: { position: idx } })
  );
  return prisma.$transaction(ops);
}
