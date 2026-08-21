CREATE TABLE IF NOT EXISTS sandbox_sessions (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  status TEXT NOT NULL,
  preview_url TEXT,
  runtime_container_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS sandbox_build_logs (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL,
  chunk TEXT NOT NULL,
  stream TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
