CREATE TABLE IF NOT EXISTS stylist_pay_plan (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  stylist_id UUID NOT NULL,
  pay_model TEXT NOT NULL,
  service_commission_bps INT NOT NULL,
  retail_commission_bps INT NOT NULL,
  booth_rent_cents INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stylist_plan
  ON stylist_pay_plan(tenant_id, stylist_id);
CREATE TABLE IF NOT EXISTS stylist_pay_period (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  stylist_id UUID NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  service_sales_cents BIGINT NOT NULL DEFAULT 0,
  retail_sales_cents BIGINT NOT NULL DEFAULT 0,
  tips_cents BIGINT NOT NULL DEFAULT 0,
  commission_cents BIGINT NOT NULL DEFAULT 0,
  booth_rent_cents BIGINT NOT NULL DEFAULT 0,
  payout_cents BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_stylist_period_stylist
  ON stylist_pay_period(tenant_id, stylist_id);
