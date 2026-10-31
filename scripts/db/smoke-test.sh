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

INSERT INTO "Link" ("id","tenantId","slug","targetUrl","updatedAt")
VALUES ('link_b','tenant_b','link-b','https://example.org',NOW());

INSERT INTO "Domain" ("id","tenantId","hostname","verificationTokenHash","updatedAt")
VALUES ('domain_a','tenant_a','a.example.com','hash-domain-a',NOW());

INSERT INTO "LinkDomainSlug" ("id","tenantId","domainId","linkId","slug")
VALUES ('mapping_a','tenant_a','domain_a','link_a','short-a');

INSERT INTO "Category" ("id","tenantId","name","slug")
VALUES ('category_a','tenant_a','Category A','category-a');

INSERT INTO "Post" ("id","tenantId","categoryId","title","slug","content","updatedAt")
VALUES ('post_a','tenant_a','category_a','Post A','post-a','Content A',NOW());

INSERT INTO "MediaAsset" ("id","tenantId","postId","storageKey","publicUrl","mimeType","sizeBytes")
VALUES ('media_a','tenant_a','post_a','tenant-a/post-a.webp','https://cdn.example.com/post-a.webp','image/webp',1024);

INSERT INTO "Plan" ("id","code","name","priceMinor","entitlements")
VALUES ('plan_test','test','Test Plan',10000,'{}'::jsonb);

INSERT INTO "Subscription" ("id","tenantId","planId","updatedAt")
VALUES ('subscription_a','tenant_a','plan_test',NOW());

INSERT INTO "Invoice" ("id","tenantId","subscriptionId","number","amountMinor","planSnapshot","lineItems")
VALUES ('invoice_a','tenant_a','subscription_a','INV-TEST-001',10000,'{"planCode":"starter","priceMinor":10000}'::jsonb,'[]'::jsonb);

INSERT INTO "PaymentAttempt" ("id","tenantId","invoiceId","provider","idempotencyKey","amountMinor")
VALUES ('payment_a','tenant_a','invoice_a','test-provider','idem-test-001',10000);

INSERT INTO "WebhookEvent" ("id","provider","providerEventId","payload")
VALUES ('webhook_a','test-provider','event-test-001','{"type":"payment.succeeded"}'::jsonb);

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

  BEGIN
    INSERT INTO "LinkDomainSlug" ("id","tenantId","domainId","linkId","slug")
    VALUES ('mapping_bad_domain','tenant_b','domain_a','link_b','short-bad-domain');
    RAISE EXCEPTION 'Cross-tenant domain reference was incorrectly accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: cross-tenant domain reference rejected';
  END;

  BEGIN
    INSERT INTO "LinkDomainSlug" ("id","tenantId","domainId","linkId","slug")
    VALUES ('mapping_bad_link','tenant_a','domain_a','link_b','short-bad-link');
    RAISE EXCEPTION 'Cross-tenant link reference was incorrectly accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: cross-tenant link reference rejected';
  END;

  BEGIN
    INSERT INTO "Post" ("id","tenantId","categoryId","title","slug","content","updatedAt")
    VALUES ('post_bad_category','tenant_b','category_a','Bad Post','bad-post','Content',NOW());
    RAISE EXCEPTION 'Cross-tenant post category reference was incorrectly accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: cross-tenant post category reference rejected';
  END;

  BEGIN
    INSERT INTO "MediaAsset" ("id","tenantId","postId","storageKey","publicUrl","mimeType","sizeBytes")
    VALUES ('media_bad_post','tenant_b','post_a','tenant-b/bad.webp','https://cdn.example.com/bad.webp','image/webp',512);
    RAISE EXCEPTION 'Cross-tenant media/post reference was incorrectly accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: cross-tenant media/post reference rejected';
  END;

  BEGIN
    INSERT INTO "Invoice" ("id","tenantId","subscriptionId","number","amountMinor","planSnapshot","lineItems")
    VALUES ('invoice_bad_subscription','tenant_b','subscription_a','INV-TEST-BAD-SUB',10000,'{}'::jsonb,'[]'::jsonb);
    RAISE EXCEPTION 'Cross-tenant invoice subscription reference was incorrectly accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: cross-tenant invoice subscription reference rejected';
  END;

  BEGIN
    INSERT INTO "PaymentAttempt" ("id","tenantId","invoiceId","provider","idempotencyKey","amountMinor")
    VALUES ('payment_bad_invoice','tenant_b','invoice_a','test-provider','idem-test-cross-tenant',10000);
    RAISE EXCEPTION 'Cross-tenant payment invoice reference was incorrectly accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: cross-tenant payment invoice reference rejected';
  END;

  BEGIN
    INSERT INTO "PaymentAttempt" ("id","tenantId","invoiceId","provider","idempotencyKey","amountMinor")
    VALUES ('payment_duplicate','tenant_a','invoice_a','test-provider','idem-test-001',10000);
    RAISE EXCEPTION 'Duplicate payment idempotency key was incorrectly accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: duplicate payment idempotency key rejected';
  END;

  BEGIN
    INSERT INTO "WebhookEvent" ("id","provider","providerEventId","payload")
    VALUES ('webhook_duplicate','test-provider','event-test-001','{"type":"payment.succeeded"}'::jsonb);
    RAISE EXCEPTION 'Duplicate provider webhook event was incorrectly accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: duplicate provider webhook event rejected';
  END;

  BEGIN
    DELETE FROM "Subscription" WHERE "id"='subscription_a';
    RAISE EXCEPTION 'Deleting a subscription referenced by an invoice should have been restricted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: referenced subscription deletion restricted';
  END;

  BEGIN
    DELETE FROM "Invoice" WHERE "id"='invoice_a';
    RAISE EXCEPTION 'Deleting an invoice referenced by a payment attempt should have been restricted';
  EXCEPTION WHEN check_violation OR foreign_key_violation THEN
    RAISE NOTICE 'PASS: invoice with payment attempt deletion restricted';
  END;

  BEGIN
    DELETE FROM "Tenant" WHERE "id"='tenant_a';
    RAISE EXCEPTION 'Deleting a tenant with billing records should have been restricted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: tenant with billing records deletion restricted';
  END;

  BEGIN
    DELETE FROM "Category" WHERE "id"='category_a';
    RAISE EXCEPTION 'Deleting a referenced category should have been restricted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: referenced category deletion restricted';
  END;

  BEGIN
    DELETE FROM "Post" WHERE "id"='post_a';
    RAISE EXCEPTION 'Deleting a referenced post should have been restricted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: referenced post deletion restricted';
  END;
END $$;

SELECT 'PASS: migration created expected tables, tenant-scoped foreign keys, and safe delete behavior' AS result;
SQL

# Database trigger protects the immutable financial snapshot while allowing lifecycle state transitions.
psql "$PSQL_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  BEGIN
    UPDATE "Invoice" SET "planSnapshot" = '{"plan":"tampered"}'::jsonb WHERE "id" = 'invoice_a';
    RAISE EXCEPTION 'Invoice plan snapshot mutation was incorrectly accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: invoice plan snapshot is immutable';
  END;

  BEGIN
    UPDATE "Invoice" SET "lineItems" = '[{"amountMinor":1}]'::jsonb WHERE "id" = 'invoice_a';
    RAISE EXCEPTION 'Invoice line item mutation was incorrectly accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: invoice line items are immutable';
  END;

  BEGIN
    UPDATE "Invoice" SET "amountMinor" = 1 WHERE "id" = 'invoice_a';
    RAISE EXCEPTION 'Invoice amount mutation was incorrectly accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: invoice amount is immutable';
  END;
END $$;

UPDATE "Invoice" SET "status" = 'OPEN' WHERE "id" = 'invoice_a';
SELECT 'PASS: invoice lifecycle status remains updateable' AS result;
SQL
