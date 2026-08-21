CREATE TABLE IF NOT EXISTS boundary_violations (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  category TEXT NOT NULL,
  layer INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_boundary_violations_session
  ON boundary_violations(user_id, persona_id, session_id, created_at);
