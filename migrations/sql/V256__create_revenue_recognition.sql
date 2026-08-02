CREATE TABLE revenue_recognition_schedules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  user_id           UUID NOT NULL,
  contract_ref      VARCHAR(255) NOT NULL,
  total_amount_cents BIGINT NOT NULL CHECK (total_amount_cents > 0),
  recognition_start DATE NOT NULL,
  recognition_end   DATE NOT NULL CHECK (recognition_end >= recognition_start),
  method            VARCHAR(30) NOT NULL DEFAULT 'straight_line' CHECK (method IN ('straight_line', 'milestone', 'usage_based')),
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_revenue_recognition_schedules_tenant_user ON revenue_recognition_schedules(tenant_id, user_id, created_at DESC);

ALTER TABLE revenue_recognition_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_recognition_schedules FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_revenue_recognition_schedules ON revenue_recognition_schedules
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
