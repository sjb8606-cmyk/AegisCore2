DROP TABLE IF EXISTS email_actions CASCADE;
DROP TABLE IF EXISTS email_drafts CASCADE;
DROP TABLE IF EXISTS email_classifications CASCADE;
DROP TABLE IF EXISTS email_messages CASCADE;

CREATE TABLE email_messages (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  message_id      TEXT NOT NULL,
  sender          TEXT NOT NULL,
  recipient       TEXT NOT NULL,
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,
  thread_id       TEXT,
  received_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, message_id)
);

CREATE TABLE email_classifications (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  email_id        UUID NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
  category        VARCHAR(50) NOT NULL,
  priority        INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 5),
  sentiment       VARCHAR(30) NOT NULL,
  intent          VARCHAR(100) NOT NULL,
  confidence      NUMERIC(5,2) NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE email_drafts (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  email_id        UUID REFERENCES email_messages(id) ON DELETE CASCADE,
  draft_text      TEXT NOT NULL,
  status          VARCHAR(30) NOT NULL CHECK (status IN ('generated','edited','sent','discarded')),
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE email_actions (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  email_id        UUID REFERENCES email_messages(id) ON DELETE CASCADE,
  action_type     VARCHAR(50) CHECK (action_type IN ('auto_reply','flag','archive','escalate','crm_tag')),
  executed        BOOLEAN DEFAULT false,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_messages ON email_messages USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_classifications ON email_classifications USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_drafts ON email_drafts USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_actions ON email_actions USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_email_tenant ON email_messages(tenant_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_classifications_email ON email_classifications(email_id);
CREATE INDEX IF NOT EXISTS idx_drafts_email ON email_drafts(email_id);
