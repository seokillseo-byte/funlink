INSERT INTO "Plan" ("id", "code", "name", "priceMinor", "currency", "interval", "entitlements", "active")
VALUES
('plan_free_2026', 'FREE', 'Free', 0, 'VND', 'MONTH', '{"linksPerMonth":20,"trackedClicksPerMonth":5000,"qrPerMonth":5,"customDomains":0,"retentionDays":30,"seats":1,"features":["FunLink branded links","Basic analytics"]}'::jsonb, true),
('plan_starter_2026', 'STARTER', 'Starter', 99000, 'VND', 'MONTH', '{"linksPerMonth":200,"trackedClicksPerMonth":50000,"qrPerMonth":50,"customDomains":1,"retentionDays":90,"seats":1,"features":["Custom domain","UTM parameters","Basic analytics"]}'::jsonb, true),
('plan_pro_2026', 'PRO', 'Pro', 249000, 'VND', 'MONTH', '{"linksPerMonth":1000,"trackedClicksPerMonth":250000,"qrPerMonth":250,"customDomains":5,"retentionDays":365,"seats":3,"features":["Bulk link creation","API access","Advanced analytics","Campaigns"]}'::jsonb, true),
('plan_agency_2026', 'AGENCY', 'Agency', 599000, 'VND', 'MONTH', '{"linksPerMonth":5000,"trackedClicksPerMonth":1000000,"qrPerMonth":1000,"customDomains":20,"retentionDays":730,"seats":10,"features":["All Pro features","Workspace roles","Priority support"]}'::jsonb, true)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "priceMinor" = EXCLUDED."priceMinor",
  "currency" = EXCLUDED."currency",
  "interval" = EXCLUDED."interval",
  "entitlements" = EXCLUDED."entitlements",
  "active" = EXCLUDED."active";
