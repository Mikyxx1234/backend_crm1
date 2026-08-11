-- Lower Campaign.sendRate DB default (new rows). Existing rows unchanged;
-- runtime clamp in API + campaign-worker still caps old sendRate=80 campaigns.
-- Table is @@map("campaigns") — quoted "Campaign" does not exist.
ALTER TABLE "campaigns" ALTER COLUMN "sendRate" SET DEFAULT 20;
