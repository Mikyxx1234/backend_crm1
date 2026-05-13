import { prisma } from "@/lib/prisma";

/**
 * Check if an agent is currently available based on their online status
 * and work schedule (timezone-aware, including lunch break and weekdays).
 */
export async function isAgentAvailable(userId: string): Promise<boolean> {
  const [agentStatus, schedule] = await Promise.all([
    prisma.agentStatus.findUnique({ where: { userId } }),
    prisma.agentSchedule.findUnique({ where: { userId } }),
  ]);

  if (agentStatus && agentStatus.status !== "ONLINE") return false;
  if (!agentStatus) return true;

  if (!schedule) return true;

  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: schedule.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });

  const parts = formatter.formatToParts(now);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? "";

  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const currentWeekday = weekdayMap[weekdayStr] ?? now.getDay();

  if (!schedule.weekdays.includes(currentWeekday)) return false;

  const currentMinutes = parseInt(hour, 10) * 60 + parseInt(minute, 10);
  const startMinutes = parseTime(schedule.startTime);
  const endMinutes = parseTime(schedule.endTime);
  const lunchStartMinutes = parseTime(schedule.lunchStart);
  const lunchEndMinutes = parseTime(schedule.lunchEnd);

  if (currentMinutes < startMinutes || currentMinutes >= endMinutes) return false;

  if (currentMinutes >= lunchStartMinutes && currentMinutes < lunchEndMinutes) return false;

  return true;
}

function parseTime(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export async function getNextOwner(pipelineId?: string): Promise<string | null> {
  const where: Record<string, unknown> = { isActive: true };
  if (pipelineId) {
    where.OR = [{ pipelineId }, { pipelineId: null }];
  } else {
    where.pipelineId = null;
  }

  const rule = await prisma.distributionRule.findFirst({
    where,
    include: { members: { include: { user: { select: { id: true } } } } },
    orderBy: { createdAt: "asc" },
  });

  if (!rule || rule.members.length === 0) return null;

  if (rule.mode === "MANUAL") return null;

  if (rule.mode === "ROUND_ROBIN") {
    const total = rule.members.length;

    for (let attempt = 0; attempt < total; attempt++) {
      const nextIndex = (rule.lastIndex + 1 + attempt) % total;
      const member = rule.members[nextIndex];

      const available = await isAgentAvailable(member.userId);
      if (available) {
        await prisma.distributionRule.update({
          where: { id: rule.id },
          data: { lastIndex: nextIndex },
        });
        return member.userId;
      }
    }

    return null;
  }

  if (rule.mode === "RULE_BASED") {
    for (const member of rule.members) {
      const available = await isAgentAvailable(member.userId);
      if (available) return member.userId;
    }
    return null;
  }

  return null;
}

export async function getDistributionRules() {
  return prisma.distributionRule.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      pipeline: { select: { id: true, name: true } },
      members: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
    },
  });
}

export async function createDistributionRule(data: {
  name: string;
  mode: "ROUND_ROBIN" | "RULE_BASED" | "MANUAL";
  pipelineId?: string | null;
  memberUserIds: string[];
}) {
  return prisma.distributionRule.create({
    data: {
      name: data.name,
      mode: data.mode,
      pipelineId: data.pipelineId ?? null,
      members: {
        create: data.memberUserIds.map((userId) => ({ userId })),
      },
    },
    include: {
      pipeline: { select: { id: true, name: true } },
      members: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
    },
  });
}

export async function updateDistributionRule(
  id: string,
  data: {
    name?: string;
    mode?: "ROUND_ROBIN" | "RULE_BASED" | "MANUAL";
    isActive?: boolean;
    pipelineId?: string | null;
    memberUserIds?: string[];
  }
) {
  return prisma.$transaction(async (tx) => {
    if (data.memberUserIds) {
      await tx.distributionMember.deleteMany({ where: { ruleId: id } });
      if (data.memberUserIds.length > 0) {
        await tx.distributionMember.createMany({
          data: data.memberUserIds.map((userId) => ({ ruleId: id, userId })),
        });
      }
    }

    return tx.distributionRule.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.mode !== undefined && { mode: data.mode }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.pipelineId !== undefined && { pipelineId: data.pipelineId }),
      },
      include: {
        pipeline: { select: { id: true, name: true } },
        members: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
  });
}

export async function deleteDistributionRule(id: string) {
  await prisma.distributionRule.delete({ where: { id } });
}
