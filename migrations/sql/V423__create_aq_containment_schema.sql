CREATE TABLE IF NOT EXISTS aq_inspection (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  site_id TEXT NOT NULL,
  holding_unit_id TEXT,
  inspection_type TEXT NOT NULL,
  due_date TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  passed BOOLEAN,
  findings TEXT,
  photo_urls JSONB NOT NULL DEFAULT '[]',
  completed_at TIMESTAMPTZ,
  actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS aq_escape_incident (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  site_id TEXT NOT NULL,
  estimated_count INT NOT NULL,
  species TEXT NOT NULL,
  cause TEXT NOT NULL,
  reportable BOOLEAN NOT NULL,
  review_status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  actor_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_aq_insp_site ON aq_inspection(tenant_id, site_id, due_date);
CREATE INDEX IF NOT EXISTS idx_aq_escape_site ON aq_escape_incident(tenant_id, site_id);
