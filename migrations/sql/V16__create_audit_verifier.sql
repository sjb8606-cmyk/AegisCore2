CREATE TABLE integrity_checks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  last_verified_seq INTEGER NOT NULL,
  last_verified_hash TEXT NOT NULL,
  status            VARCHAR(20) NOT NULL, -- 'valid' or 'corrupted'
  errors            TEXT,
  verified_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Harden with RLS
ALTER TABLE integrity_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrity_checks FORCE ROW LEVEL SECURITY;

CREATE POLICY integrity_tenant_isolation ON integrity_checks
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
