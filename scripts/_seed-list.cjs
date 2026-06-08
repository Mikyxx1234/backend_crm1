const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const orgs = await p.organization.findMany({ select: { id: true, name: true } });
  console.log("ORGS:", JSON.stringify(orgs, null, 2));
  const stages = await p.stage.findMany({
    include: { pipeline: { select: { name: true } } },
    orderBy: [{ pipeline: { name: "asc" } }, { position: "asc" }],
    take: 50,
  });
  console.log(
    "STAGES:",
    JSON.stringify(
      stages.map((s) => ({
        org: s.organizationId,
        pipeline: s.pipeline.name,
        stage: s.name,
        stageId: s.id,
      })),
      null,
      2
    )
  );
  await p.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
