CREATE TABLE IF NOT EXISTS sch_recurring_series (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  resource_id TEXT,
  title TEXT NOT NULL,
  frequency TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  duration_minutes INT NOT NULL,
  count INT NOT NULL,
  exception_dates JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sch_series_occurrence (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  series_id UUID NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sch_occ_series
  ON sch_series_occurrence(tenant_id, series_id, start_at);
