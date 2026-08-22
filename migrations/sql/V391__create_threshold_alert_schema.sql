CREATE TABLE IF NOT EXISTS alert_rule (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  entity_type TEXT NOT NULL,
  metric TEXT NOT NULL,
  operator TEXT NOT NULL,
  threshold NUMERIC NOT NULL,
  hysteresis NUMERIC NOT NULL DEFAULT 0,
  action TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS alert_event (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  rule_id UUID NOT NULL,
  entity_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  value NUMERIC NOT NULL,
  triggered_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  action_fired TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alert_event_open
  ON alert_event(tenant_id, status);
