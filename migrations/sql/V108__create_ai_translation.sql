DROP TABLE IF EXISTS locale_configs CASCADE;
DROP TABLE IF EXISTS translation_memory CASCADE;
DROP TABLE IF EXISTS translation_glossaries CASCADE;
DROP TABLE IF EXISTS translation_jobs CASCADE;

CREATE TABLE translation_jobs (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  source_text       TEXT NOT NULL,
  source_language   VARCHAR(10) NOT NULL,
  target_language   VARCHAR(10) NOT NULL,
  translated_text   TEXT,
  confidence        NUMERIC(5,2) DEFAULT 1.00 NOT NULL,
  status            VARCHAR(30) DEFAULT 'pending' CHECK (status IN ('pending','completed','failed')),
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE translation_glossaries (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  term              TEXT NOT NULL,
  translation       TEXT NOT NULL,
  language          VARCHAR(10) NOT NULL,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE translation_memory (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  source_text       TEXT NOT NULL,
  source_language   VARCHAR(10) NOT NULL,
  target_language   VARCHAR(10) NOT NULL,
  translated_text   TEXT NOT NULL,
  usage_count       INTEGER DEFAULT 1 NOT NULL,
  last_used_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE locale_configs (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  locale            VARCHAR(20) NOT NULL,
  currency          VARCHAR(10) NOT NULL,
  date_format       VARCHAR(20) NOT NULL,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE translation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE translation_glossaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE translation_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE locale_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_jobs ON translation_jobs USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_glossaries ON translation_glossaries USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_memory ON translation_memory USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_locale ON locale_configs USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_jobs_tenant ON translation_jobs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_glossaries_tenant ON translation_glossaries(tenant_id, term);
CREATE INDEX IF NOT EXISTS idx_memory_lookup ON translation_memory(tenant_id, source_text, source_language, target_language);
