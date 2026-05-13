-- Loss Reasons
CREATE TABLE IF NOT EXISTS "loss_reasons" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "label"     TEXT NOT NULL,
  "position"  INTEGER NOT NULL DEFAULT 0,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
