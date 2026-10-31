ALTER TABLE "PaymentAttempt"
  ADD COLUMN "providerCheckoutId" TEXT,
  ADD COLUMN "providerCheckoutUrl" TEXT;

CREATE UNIQUE INDEX "PaymentAttempt_provider_providerCheckoutId_key"
  ON "PaymentAttempt"("provider", "providerCheckoutId");
