CREATE TABLE podcast_episodes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  user_id           UUID NOT NULL,
  title             VARCHAR(255) NOT NULL,
  description       TEXT,
  audio_url         TEXT NOT NULL,
  duration_seconds  INTEGER CHECK (duration_seconds >= 0),
  published_at      TIMESTAMP WITH TIME ZONE,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_podcast_episodes_tenant_created ON podcast_episodes(tenant_id, created_at DESC);

ALTER TABLE podcast_episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE podcast_episodes FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_podcast_episodes ON podcast_episodes
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
