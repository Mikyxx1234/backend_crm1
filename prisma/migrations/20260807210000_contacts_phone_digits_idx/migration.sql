-- Acelera findContactIdsByPhoneDigits: reverse(digits) LIKE 'sufixo_rev%'
-- usa prefixo em btree (LIKE '%x' puro não usa índice).
CREATE INDEX IF NOT EXISTS "contacts_org_phone_digits_rev_idx"
ON "contacts" (
  "organizationId",
  (reverse(regexp_replace(COALESCE(phone, ''), '\D', '', 'g')))
);
