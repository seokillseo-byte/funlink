CREATE OR REPLACE FUNCTION "funlink_guard_invoice_snapshot"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Invoice financial records cannot be deleted'
      USING ERRCODE = '23514';
  END IF;

  IF ROW(
    OLD."tenantId",
    OLD."subscriptionId",
    OLD."number",
    OLD."amountMinor",
    OLD."currency",
    OLD."planSnapshot",
    OLD."lineItems"
  ) IS DISTINCT FROM ROW(
    NEW."tenantId",
    NEW."subscriptionId",
    NEW."number",
    NEW."amountMinor",
    NEW."currency",
    NEW."planSnapshot",
    NEW."lineItems"
  ) THEN
    RAISE EXCEPTION 'Invoice financial snapshot is immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "Invoice_snapshot_immutable"
BEFORE UPDATE OR DELETE ON "Invoice"
FOR EACH ROW
EXECUTE FUNCTION "funlink_guard_invoice_snapshot"();
