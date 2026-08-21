CREATE TABLE IF NOT EXISTS personas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  json_config JSONB NOT NULL DEFAULT '{}',
  tier_required TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true
);
