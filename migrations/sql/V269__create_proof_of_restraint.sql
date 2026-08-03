-- Idempotency guard to clear any half-applied schema state
DROP TABLE IF EXISTS proof_of_restraint CASCADE;

-- Genuine tenant-scoped data, matching the AppSpec's own explicit
-- schema for this table. Deliberately insert-only from the
-- application layer — restraint-store.ts provides no update/delete
-- function at all, matching "immutably" in this bot's own name.
CREATE TABLE proof_of_restraint (
  id             UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  bot_id         TEXT NOT NULL,
  action_blocked TEXT NOT NULL,
  refusal_reason TEXT NOT NULL,
  input_context  JSONB NOT NULL DEFAULT '{}'::jsonb,
  receipt_id     TEXT,
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE proof_of_restraint ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_proof_of_restraint ON proof_of_restraint
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_proof_of_restraint_bot ON proof_of_restraint(tenant_id, bot_id, created_at DESC);
