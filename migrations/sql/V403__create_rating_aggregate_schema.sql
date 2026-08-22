CREATE TABLE IF NOT EXISTS rating (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  score NUMERIC NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rating_one_per_user
  ON rating(tenant_id, entity_type, entity_id, user_id);
CREATE TABLE IF NOT EXISTS entity_rating_cache (
  tenant_id UUID NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  average_rating NUMERIC NOT NULL DEFAULT 0,
  rating_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, entity_type, entity_id)
);
