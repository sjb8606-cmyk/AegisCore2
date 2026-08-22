CREATE TABLE IF NOT EXISTS record_type_schema (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  fields JSONB NOT NULL,
  parse_hints JSONB NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS voice_capture (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  schema_id UUID NOT NULL,
  raw_audio_ref TEXT,
  transcript TEXT,
  parsed_fields JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  committed_entity_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
