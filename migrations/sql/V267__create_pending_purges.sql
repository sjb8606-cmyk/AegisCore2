-- Idempotency guard to clear any half-applied schema state
DROP TABLE IF EXISTS pending_purges CASCADE;

-- Genuine tenant-scoped customer data (unlike bot_decisions, which is
-- system-level swarm bookkeeping) — a purge request names real
-- customer data to be deleted, so this table IS RLS-protected,
-- matching the tenant_isolation pattern used elsewhere in this repo.
CREATE TABLE pending_purges (
  id            UUID PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  data_scope    TEXT NOT NULL,          -- what will be deleted
  authorized_by TEXT NOT NULL,          -- actor id who requested it (CISO-only, per AppSpec)
  unlocks_at    TIMESTAMP WITH TIME ZONE NOT NULL,  -- now() + 24h at request time
  status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'executed', 'cancelled')),
  -- Real Veridact receipts aren't available yet (@features/veridact has
  -- not been built in this repo) — this is a nullable placeholder, not
  -- a fabricated cryptographic receipt.
  receipt_id    TEXT,
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at    TIMESTAMP WITH TIME ZONE  -- when cancelled or executed
);

ALTER TABLE pending_purges ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_pending_purges ON pending_purges
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_pending_purges_status_unlock ON pending_purges(status, unlocks_at);
