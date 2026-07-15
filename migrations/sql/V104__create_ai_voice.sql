DROP TABLE IF EXISTS voice_commands CASCADE;
DROP TABLE IF EXISTS voice_summaries CASCADE;
DROP TABLE IF EXISTS voice_speakers CASCADE;
DROP TABLE IF EXISTS voice_transcriptions CASCADE;

CREATE TABLE voice_transcriptions (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  source_type       VARCHAR(30) CHECK (source_type IN ('upload','stream','call')),
  audio_url         TEXT NOT NULL,
  transcript        TEXT,
  confidence        NUMERIC(5,2),
  language          VARCHAR(10) DEFAULT 'en',
  duration_sec      INTEGER,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE voice_speakers (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  transcription_id  UUID NOT NULL REFERENCES voice_transcriptions(id) ON DELETE CASCADE,
  speaker_label     VARCHAR(50) NOT NULL,
  start_time        NUMERIC NOT NULL,
  end_time          NUMERIC NOT NULL,
  text              TEXT NOT NULL
);

CREATE TABLE voice_summaries (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  transcription_id  UUID NOT NULL REFERENCES voice_transcriptions(id) ON DELETE CASCADE,
  summary           TEXT NOT NULL,
  action_items      JSONB DEFAULT '[]',
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE voice_commands (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  raw_text          TEXT NOT NULL,
  intent            VARCHAR(100),
  confidence        NUMERIC(5,2),
  executed          BOOLEAN DEFAULT false,
  executed_at       TIMESTAMP WITH TIME ZONE,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE voice_transcriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_speakers ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_transcriptions ON voice_transcriptions USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_speakers ON voice_speakers USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_summaries ON voice_summaries USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_commands ON voice_commands USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_transcriptions_tenant ON voice_transcriptions(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_summaries_transcription ON voice_summaries(transcription_id);
CREATE INDEX IF NOT EXISTS idx_commands_tenant ON voice_commands(tenant_id, created_at DESC);
