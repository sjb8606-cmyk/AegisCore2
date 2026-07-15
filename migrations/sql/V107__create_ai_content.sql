DROP TABLE IF EXISTS content_scores CASCADE;
DROP TABLE IF EXISTS content_keywords CASCADE;
DROP TABLE IF EXISTS content_variants CASCADE;
DROP TABLE IF EXISTS content_assets CASCADE;

CREATE TABLE content_assets (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  type            VARCHAR(50) CHECK (type IN ('blog','ad','social','product','landing_page')),
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  tone            VARCHAR(50) NOT NULL,
  language        VARCHAR(10) DEFAULT 'en' NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE content_variants (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  content_id        UUID NOT NULL REFERENCES content_assets(id) ON DELETE CASCADE,
  variant_text      TEXT NOT NULL,
  variant_type      VARCHAR(30) CHECK (variant_type IN ('seo','ad','social','tone_shift')),
  score             NUMERIC(5,2),
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE content_keywords (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  content_id      UUID NOT NULL REFERENCES content_assets(id) ON DELETE CASCADE,
  keyword         VARCHAR(255) NOT NULL,
  weight          NUMERIC(5,2) NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE content_scores (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  content_id        UUID NOT NULL REFERENCES content_assets(id) ON DELETE CASCADE,
  engagement_score  NUMERIC(5,2) NOT NULL,
  seo_score         NUMERIC(5,2) NOT NULL,
  brand_score       NUMERIC(5,2) NOT NULL,
  risk_score        NUMERIC(5,2) NOT NULL,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE content_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_assets ON content_assets USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_variants ON content_variants USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_keywords ON content_keywords USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_scores ON content_scores USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_assets_tenant ON content_assets(tenant_id, type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_variants_content ON content_variants(content_id);
CREATE INDEX IF NOT EXISTS idx_scores_content ON content_scores(content_id);
