-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS helpdesk_agents CASCADE;
DROP TABLE IF EXISTS kb_articles CASCADE;
DROP TABLE IF EXISTS canned_responses CASCADE;
DROP TABLE IF EXISTS ticket_messages CASCADE;
DROP TABLE IF EXISTS tickets CASCADE;

CREATE TABLE tickets (
  id                  UUID PRIMARY KEY,
  tenant_id           UUID NOT NULL,
  ticket_number       VARCHAR(20) NOT NULL,
  subject             VARCHAR(500) NOT NULL,
  description         TEXT NOT NULL,
  status              VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open','pending','on_hold','resolved','closed')),
  priority            VARCHAR(10) DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  channel             VARCHAR(20) DEFAULT 'web' CHECK (channel IN ('web','email','chat','phone','api')),
  requester_id        UUID,
  requester_email     VARCHAR(255) NOT NULL,
  requester_name      VARCHAR(255),
  assigned_to         UUID,
  team_id             UUID,
  tags                TEXT[] DEFAULT '{}',
  custom_fields       JSONB DEFAULT '{}',
  sla_breach_at       TIMESTAMP WITH TIME ZONE,
  first_response_at   TIMESTAMP WITH TIME ZONE,
  resolved_at         TIMESTAMP WITH TIME ZONE,
  closed_at           TIMESTAMP WITH TIME ZONE,
  satisfaction_score  INTEGER CHECK (satisfaction_score BETWEEN 1 AND 5),
  metadata            JSONB DEFAULT '{}',
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at          TIMESTAMP WITH TIME ZONE,
  UNIQUE(tenant_id, ticket_number)
);

CREATE TABLE ticket_messages (
  id            UUID PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  ticket_id     UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id     UUID,
  author_email  VARCHAR(255),
  author_name   VARCHAR(255),
  body          TEXT NOT NULL,
  is_internal   BOOLEAN DEFAULT FALSE,
  is_automated  BOOLEAN DEFAULT FALSE,
  attachments   JSONB DEFAULT '[]',
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE canned_responses (
  id          UUID PRIMARY KEY,
  tenant_id   UUID NOT NULL,
  title       VARCHAR(255) NOT NULL,
  body        TEXT NOT NULL,
  tags        TEXT[] DEFAULT '{}',
  use_count   INTEGER DEFAULT 0,
  created_by  UUID NOT NULL,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at  TIMESTAMP WITH TIME ZONE
);

CREATE TABLE kb_articles (
  id            UUID PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  title         VARCHAR(255) NOT NULL,
  body          TEXT NOT NULL,
  category      VARCHAR(100),
  tags          TEXT[] DEFAULT '{}',
  is_public     BOOLEAN DEFAULT TRUE,
  view_count    INTEGER DEFAULT 0,
  helpful_count INTEGER DEFAULT 0,
  created_by    UUID NOT NULL,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at    TIMESTAMP WITH TIME ZONE
);

CREATE TABLE helpdesk_agents (
  id          UUID PRIMARY KEY,
  tenant_id   UUID NOT NULL,
  user_id     UUID NOT NULL,
  name        VARCHAR(255) NOT NULL,
  email       VARCHAR(255) NOT NULL,
  is_active   BOOLEAN DEFAULT TRUE,
  ticket_count INTEGER DEFAULT 0,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, user_id)
);

ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE canned_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk_agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_tickets ON tickets USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_messages ON ticket_messages USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_canned ON canned_responses USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_kb ON kb_articles USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_agents ON helpdesk_agents USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_tickets_tenant_status ON tickets(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned ON tickets(tenant_id, assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_tickets_requester ON tickets(tenant_id, requester_email);
CREATE INDEX IF NOT EXISTS idx_tickets_sla ON tickets(tenant_id, sla_breach_at) WHERE sla_breach_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_ticket ON ticket_messages(ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_kb_public ON kb_articles(tenant_id, is_public) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agents_tenant ON helpdesk_agents(tenant_id, is_active);
