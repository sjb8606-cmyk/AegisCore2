-- Idempotency guard to clear any half-applied schema state
DROP TABLE IF EXISTS bot_decisions CASCADE;

-- Deliberately NON-RLS, same pattern as signature_tokens (contracts.ts).
-- Bot decisions are system-level swarm data (SYSTEM_TENANT_ID / 'system'
-- actor), not per-tenant customer data — there is no real tenant UUID to
-- key RLS off of, so this table is queried directly via getPool(),
-- never via withTenantQuery().
CREATE TABLE bot_decisions (
  decision_id   UUID PRIMARY KEY,
  bot_id        VARCHAR(10)  NOT NULL,       -- e.g. 'D-06'
  status        VARCHAR(20)  NOT NULL,       -- DecisionStatus: logged | pending_approval | approved | rejected
  input         JSONB        NOT NULL DEFAULT '{}',
  output        JSONB        NOT NULL DEFAULT '{}',
  rules_hash    VARCHAR(255) NOT NULL,
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- explainDecision() looks up a single decision by id (primary key covers
-- that); this index supports listing a bot's own recent decisions for
-- future use (e.g. "walk me through what you found last time").
CREATE INDEX IF NOT EXISTS idx_bot_decisions_bot_id ON bot_decisions(bot_id, created_at DESC);
