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

# Hardened billing relations and retained editorial records.
psql "$PSQL_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO "Plan" ("id","code","name","priceMinor","entitlements")
VALUES ('plan_a','starter','Starter',10000,'{"links":100}'::jsonb);

INSERT INTO "Subscription" ("id","tenantId","planId","updatedAt")
VALUES ('subscription_a','tenant_a','plan_a',NOW());

INSERT INTO "Invoice" ("id","tenantId","subscriptionId","number","amountMinor","planSnapshot","lineItems")
VALUES (
  'invoice_a','tenant_a','subscription_a','INV-TENANT-A',10000,
  '{"plan":"starter"}'::jsonb,'[{"amountMinor":10000}]'::jsonb
);

INSERT INTO "PaymentAttempt" ("id","tenantId","invoiceId","provider","idempotencyKey","amountMinor")
VALUES ('payment_a','tenant_a','invoice_a','testpay','idem-a',10000);

INSERT INTO "Category" ("id","tenantId","name","slug")
VALUES ('category_a','tenant_a','News','news');

INSERT INTO "Post" ("id","tenantId","categoryId","title","slug","content","updatedAt")
VALUES ('post_a','tenant_a','category_a','Post A','post-a','Content',NOW());

INSERT INTO "MediaAsset" ("id","tenantId","postId","storageKey","publicUrl","mimeType","sizeBytes")
VALUES ('media_a','tenant_a','post_a','media-a','https://example.com/media-a.webp','image/webp',1024);

DO $
BEGIN
  BEGIN
    INSERT INTO "Invoice" ("id","tenantId","subscriptionId","number","amountMinor","planSnapshot","lineItems")
    VALUES ('invoice_cross_tenant','tenant_b','subscription_a','INV-CROSS-TENANT',10000,'{}'::jsonb,'[]'::jsonb);
    RAISE EXCEPTION 'Cross-tenant invoice/subscription relation was incorrectly accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: cross-tenant invoice/subscription relation rejected';
  END;

  BEGIN
    INSERT INTO "PaymentAttempt" ("id","tenantId","invoiceId","provider","idempotencyKey","amountMinor")
    VALUES ('payment_cross_tenant','tenant_b','invoice_a','testpay','idem-cross-tenant',10000);
    RAISE EXCEPTION 'Cross-tenant payment/invoice relation was incorrectly accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: cross-tenant payment/invoice relation rejected';
  END;

  BEGIN
    DELETE FROM "Subscription" WHERE "id" = 'subscription_a';
    RAISE EXCEPTION 'Deleting a subscription referenced by an invoice was incorrectly accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: subscription referenced by invoice cannot be deleted';
  END;

  BEGIN
    DELETE FROM "Invoice" WHERE "id" = 'invoice_a';
    RAISE EXCEPTION 'Deleting an invoice referenced by a payment attempt was incorrectly accepted';
  EXCEPTION WHEN check_violation OR foreign_key_violation THEN
    RAISE NOTICE 'PASS: invoice referenced by payment history cannot be deleted';
  END;

  BEGIN
    DELETE FROM "Tenant" WHERE "id" = 'tenant_a';
    RAISE EXCEPTION 'Deleting a tenant with billing records was incorrectly accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: tenant with billing records cannot be deleted';
  END;

  BEGIN
    DELETE FROM "Category" WHERE "id" = 'category_a';
    RAISE EXCEPTION 'Deleting a category with posts was incorrectly accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: category referenced by post cannot be deleted';
  END;

  BEGIN
    DELETE FROM "Post" WHERE "id" = 'post_a';
    RAISE EXCEPTION 'Deleting a post referenced by media was incorrectly accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: post referenced by media cannot be deleted';
  END;
END $;
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
