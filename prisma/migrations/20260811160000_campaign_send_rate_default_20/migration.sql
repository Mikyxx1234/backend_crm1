-- Lower Campaign.sendRate DB default (new rows). Existing rows unchanged;
-- runtime clamp in API + campaign-worker still caps old sendRate=80 campaigns.
ALTER TABLE "Campaign" ALTER COLUMN "sendRate" SET DEFAULT 20;
