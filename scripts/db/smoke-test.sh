#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"

table_count="$(psql "$DATABASE_URL" -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';")"
if [ "$table_count" -lt 20 ]; then
  echo "Expected at least 20 application tables, found $table_count"
  exit 1
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
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
