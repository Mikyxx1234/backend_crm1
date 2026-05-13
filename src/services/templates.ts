import type { ChannelType, TemplateStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export async function getTemplates() {
  return prisma.messageTemplate.findMany({ orderBy: { name: "asc" } });
}

export async function getTemplateById(id: string) {
  return prisma.messageTemplate.findUnique({ where: { id } });
}

export async function createTemplate(data: {
  name: string;
  content: string;
  category?: string;
  language?: string;
  channelType?: ChannelType;
}) {
  return prisma.messageTemplate.create({
    data: {
      name: data.name,
      content: data.content,
      category: data.category ?? null,
      language: data.language ?? "pt_BR",
      channelType: data.channelType ?? null,
    },
  });
}

export async function updateTemplate(
  id: string,
  data: {
    name?: string;
    content?: string;
    category?: string;
    language?: string;
    status?: TemplateStatus;
    channelType?: ChannelType | null;
  }
) {
  return prisma.messageTemplate.update({ where: { id }, data });
}

export async function deleteTemplate(id: string) {
  return prisma.messageTemplate.delete({ where: { id } });
}
