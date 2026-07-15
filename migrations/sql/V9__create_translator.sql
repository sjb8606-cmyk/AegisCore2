CREATE TABLE translation_cache (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  original_hash   TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  reading_level   VARCHAR(50) NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Harden with RLS
ALTER TABLE translation_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE translation_cache FORCE ROW LEVEL SECURITY;

CREATE POLICY translator_tenant_isolation ON translation_cache
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX idx_translation_lookup ON translation_cache(tenant_id, original_hash);
