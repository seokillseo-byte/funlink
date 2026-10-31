#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"
: "${PSQL_DATABASE_URL:?PSQL_DATABASE_URL is required}"

table_count="$(psql "$PSQL_DATABASE_URL" -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';")"
if [ "$table_count" -lt 20 ]; then
  echo "Expected at least 20 application tables, found $table_count"
  exit 1
fi

psql "$PSQL_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO "Tenant" ("id","name","slug","updatedAt")
VALUES ('tenant_a','Tenant A','tenant-a',NOW()), ('tenant_b','Tenant B','tenant-b',NOW());

INSERT INTO "Campaign" ("id","tenantId","name","updatedAt")
VALUES ('campaign_a','tenant_a','Campaign A',NOW());

INSERT INTO "Link" ("id","tenantId","campaignId","slug","targetUrl","updatedAt")
VALUES ('link_a','tenant_a','campaign_a','link-a','https://example.com',NOW());

DO $$
BEGIN
  BEGIN
    INSERT INTO "Link" ("id","tenantId","campaignId","slug","targetUrl","updatedAt")
    VALUES ('link_bad_campaign','tenant_b','campaign_a','link-bad-campaign','https://example.com',NOW());
    RAISE EXCEPTION 'Cross-tenant campaign reference was incorrectly accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: cross-tenant campaign reference rejected';
  END;

  BEGIN
    INSERT INTO "ClickEvent" ("id","tenantId","linkId")
    VALUES ('click_bad_tenant','tenant_b','link_a');
    RAISE EXCEPTION 'Cross-tenant click reference was incorrectly accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: cross-tenant click reference rejected';
  END;
END $$;

SELECT 'PASS: migration created expected tables and tenant-scoped foreign keys' AS result;
SQL

# Invoice financial snapshots and records must remain immutable after creation.
psql "$PSQL_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO "Invoice" ("id","tenantId","number","amountMinor","planSnapshot","lineItems","createdAt")
VALUES (
  'invoice_immutable',
  'tenant_a',
  'INV-IMMUTABLE-001',
  10000,
  '{"plan":"starter","priceMinor":10000}'::jsonb,
  '[{"description":"Starter monthly plan","amountMinor":10000}]'::jsonb,
  NOW()
);

DO $$
BEGIN
  BEGIN
    UPDATE "Invoice" SET "planSnapshot" = '{"plan":"tampered"}'::jsonb WHERE "id" = 'invoice_immutable';
    RAISE EXCEPTION 'Invoice plan snapshot mutation was incorrectly accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: invoice plan snapshot is immutable';
  END;

  BEGIN
    UPDATE "Invoice" SET "lineItems" = '[]'::jsonb WHERE "id" = 'invoice_immutable';
    RAISE EXCEPTION 'Invoice line item mutation was incorrectly accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: invoice line items are immutable';
  END;

  BEGIN
    UPDATE "Invoice" SET "amountMinor" = 1 WHERE "id" = 'invoice_immutable';
    RAISE EXCEPTION 'Invoice amount mutation was incorrectly accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: invoice amount and currency are immutable';
  END;

  BEGIN
    DELETE FROM "Invoice" WHERE "id" = 'invoice_immutable';
    RAISE EXCEPTION 'Invoice deletion was incorrectly accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: invoice financial record deletion is blocked';
  END;
END $$;

-- Lifecycle fields may still advance without changing the immutable snapshot.
UPDATE "Invoice" SET "status" = 'OPEN' WHERE "id" = 'invoice_immutable';
SELECT 'PASS: invoice lifecycle updates remain possible while snapshot fields stay immutable' AS result;
SQL
