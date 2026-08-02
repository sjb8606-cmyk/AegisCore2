CREATE TABLE cms_pages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  user_id     UUID NOT NULL,
  slug        VARCHAR(255) NOT NULL,
  title       VARCHAR(255) NOT NULL,
  body        TEXT NOT NULL,
  published   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, slug)
);

CREATE INDEX idx_cms_pages_tenant_created ON cms_pages(tenant_id, created_at DESC);

ALTER TABLE cms_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_pages FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_cms_pages ON cms_pages
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
