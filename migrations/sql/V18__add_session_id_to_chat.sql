-- Add session_id to conversations table
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS session_id UUID;

-- Index it for fast memory retrieval
CREATE INDEX IF NOT EXISTS idx_conv_session ON conversations(tenant_id, session_id);
