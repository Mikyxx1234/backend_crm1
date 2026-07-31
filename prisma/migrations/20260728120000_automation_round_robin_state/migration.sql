CREATE TABLE "automation_round_robin_states" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "lastIndex" INTEGER NOT NULL DEFAULT -1,
    "optionsSignature" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_round_robin_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "automation_round_robin_state_automation_step_uq"
ON "automation_round_robin_states"("automationId", "stepId");

CREATE INDEX "automation_round_robin_state_org_idx"
ON "automation_round_robin_states"("organizationId");

ALTER TABLE "automation_round_robin_states"
ADD CONSTRAINT "automation_round_robin_state_org_fk"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "automation_round_robin_states"
ADD CONSTRAINT "automation_round_robin_state_automation_fk"
FOREIGN KEY ("automationId") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
