CREATE TABLE IF NOT EXISTS ingestion_source (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  connection_config JSONB NOT NULL DEFAULT '{}',
  schema_map JSONB NOT NULL,
  required_fields JSONB NOT NULL DEFAULT '[]',
  schedule_cron TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ingestion_raw (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  source_id UUID NOT NULL,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS ingestion_normalized (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  source_id UUID NOT NULL,
  raw_id UUID NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ingestion_error_queue (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  source_id UUID NOT NULL,
  raw_id UUID,
  error TEXT NOT NULL,
  retries INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
