CREATE TABLE IF NOT EXISTS worm_audit_log (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  changes JSONB NOT NULL DEFAULT '{}',
  chain_hash TEXT NOT NULL,
  previous_hash TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_worm_audit_entity
  ON worm_audit_log(tenant_id, entity_type, entity_id, timestamp);

-- WORM enforcement (Postgres): block UPDATE/DELETE
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_rules WHERE rulename = 'worm_audit_no_update'
  ) THEN
    CREATE RULE worm_audit_no_update AS ON UPDATE TO worm_audit_log DO INSTEAD NOTHING;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_rules WHERE rulename = 'worm_audit_no_delete'
  ) THEN
    CREATE RULE worm_audit_no_delete AS ON DELETE TO worm_audit_log DO INSTEAD NOTHING;
  END IF;
END $$;
