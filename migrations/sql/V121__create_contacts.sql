DROP TABLE IF EXISTS contact_activity CASCADE;
DROP TABLE IF EXISTS contact_field_values CASCADE;
DROP TABLE IF EXISTS contact_custom_fields CASCADE;
DROP TABLE IF EXISTS contact_tags CASCADE;
DROP TABLE IF EXISTS contacts CASCADE;

CREATE TABLE contacts (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  type            VARCHAR(20) NOT NULL CHECK (type IN ('person', 'organization')),
  first_name      VARCHAR(255),
  last_name       VARCHAR(255),
  org_name        VARCHAR(255),
  email           VARCHAR(255),
  phone           VARCHAR(50),
  website         VARCHAR(255),
  address         JSONB DEFAULT '{}' NOT NULL,
  owner_ref       UUID,
  user_id         UUID,
  organization_id UUID,
  status          VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'archived', 'merged')),
  merged_into_id  UUID,
  metadata        JSONB DEFAULT '{}' NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at      TIMESTAMP WITH TIME ZONE
);

ALTER TABLE contacts ADD CONSTRAINT fk_organization FOREIGN KEY (organization_id) REFERENCES contacts(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE contacts ADD CONSTRAINT fk_merged_into FOREIGN KEY (merged_into_id) REFERENCES contacts(id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE contact_tags (
  id         UUID PRIMARY KEY,
  tenant_id  UUID NOT NULL,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag        VARCHAR(100) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, contact_id, tag)
);

CREATE TABLE contact_custom_fields (
  id         UUID PRIMARY KEY,
  tenant_id  UUID NOT NULL,
  name       VARCHAR(100) NOT NULL,
  field_type VARCHAR(30) CHECK (field_type IN ('text','number','boolean','date','select')) NOT NULL,
  options    JSONB DEFAULT '[]' NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, name)
);

CREATE TABLE contact_field_values (
  id         UUID PRIMARY KEY,
  tenant_id  UUID NOT NULL,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  field_id   UUID NOT NULL REFERENCES contact_custom_fields(id) ON DELETE CASCADE,
  value      JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, contact_id, field_id)
);

CREATE TABLE contact_activity (
  id            UUID PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  contact_id    UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  activity_type VARCHAR(50) CHECK (activity_type IN ('note','call','email','meeting','task','status_change','field_update')) NOT NULL,
  summary       TEXT NOT NULL,
  actor_ref     UUID NOT NULL,
  metadata      JSONB DEFAULT '{}' NOT NULL,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_custom_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_field_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_contacts ON contacts USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_tags ON contact_tags USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_fields ON contact_custom_fields USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_field_values ON contact_field_values USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_activity ON contact_activity USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX idx_contacts_tenant_type ON contacts(tenant_id, type);
CREATE INDEX idx_contacts_email ON contacts(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_contact_activity_contact ON contact_activity(contact_id, created_at DESC);
