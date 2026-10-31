ALTER TABLE "Domain"
  ALTER COLUMN "verificationTokenHash" DROP NOT NULL,
  ADD COLUMN "verificationExpiresAt" TIMESTAMP(3),
  ADD COLUMN "verificationAttempts" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Domain_tenantId_status_verificationExpiresAt_idx"
  ON "Domain"("tenantId", "status", "verificationExpiresAt");
