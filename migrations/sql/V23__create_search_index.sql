-- We use the pg_trgm extension for "Fuzzy" (typo-tolerant) searching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE search_index (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  entity_type     VARCHAR(100) NOT NULL,
  entity_id       TEXT NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT,
  search_vec      tsvector GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || coalesce(body, ''))) STORED,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, entity_type, entity_id)
);

-- Security Hardening
ALTER TABLE search_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_index FORCE ROW LEVEL SECURITY;

CREATE POLICY search_tenant_isolation ON search_index 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- High-Speed Indexes
CREATE INDEX idx_search_vec ON search_index USING GIN(search_vec);
CREATE INDEX idx_search_fuzzy ON search_index USING GIST(title gist_trgm_ops);
