CREATE TABLE IF NOT EXISTS video_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  host_id           UUID,
  room_name         VARCHAR(255) NOT NULL,
  status            VARCHAR(30) DEFAULT 'scheduled' CHECK (status IN ('scheduled','active','ended')),
  started_at        TIMESTAMPTZ,
  ended_at          TIMESTAMPTZ,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS video_participants (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  session_id        UUID NOT NULL REFERENCES video_sessions(id),
  user_id           UUID,
  role              VARCHAR(30) CHECK (role IN ('host','guest','moderator')),
  joined_at         TIMESTAMPTZ,
  left_at           TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS video_recordings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  session_id        UUID NOT NULL REFERENCES video_sessions(id),
  storage_url       TEXT,
  duration_sec      INTEGER,
  encrypted         BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS video_transcripts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  session_id        UUID NOT NULL REFERENCES video_sessions(id),
  transcript        TEXT,
  language          VARCHAR(10),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security Activation
ALTER TABLE video_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_sessions FORCE ROW LEVEL SECURITY;

ALTER TABLE video_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_participants FORCE ROW LEVEL SECURITY;

ALTER TABLE video_recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_recordings FORCE ROW LEVEL SECURITY;

ALTER TABLE video_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_transcripts FORCE ROW LEVEL SECURITY;

-- Dynamic Tenant Isolation Policies
CREATE POLICY tenant_isolation_sessions ON video_sessions 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_participants ON video_participants 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_recordings ON video_recordings 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_transcripts ON video_transcripts 
    FOR ALL 
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) 
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Core Query Optimization Indices
CREATE INDEX IF NOT EXISTS idx_sessions_tenant ON video_sessions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_participants_session ON video_participants(session_id);
CREATE INDEX IF NOT EXISTS idx_recordings_session ON video_recordings(session_id);
