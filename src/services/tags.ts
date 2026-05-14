import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";

export type CreateTagInput = {
  name: string;
  color?: string;
};

export async function getTags() {
  return prisma.tag.findMany({
    orderBy: { name: "asc" },
  });
}

export async function getTagById(id: string) {
  return prisma.tag.findUnique({ where: { id } });
}

export async function createTag(data: CreateTagInput) {
  return prisma.tag.create({
    data: withOrgFromCtx({
      name: data.name.trim(),
      color: data.color?.trim() || undefined,
    }),
  });
}

export async function addTagToContact(contactId: string, tagId: string) {
  return prisma.tagOnContact.create({
    data: { contactId, tagId },
    include: {
      tag: { select: { id: true, name: true, color: true } },
    },
  });
}

export async function removeTagFromContact(contactId: string, tagId: string) {
  await prisma.tagOnContact.delete({
    where: {
      contactId_tagId: { contactId, tagId },
    },
  });
}
