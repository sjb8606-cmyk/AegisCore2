ALTER TABLE agent_definitions ADD COLUMN IF NOT EXISTS persona_id VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_agent_defs_persona ON agent_definitions(persona_id);
