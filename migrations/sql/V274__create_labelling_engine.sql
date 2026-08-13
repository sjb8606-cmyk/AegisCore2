CREATE TABLE IF NOT EXISTS label_market_rules (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  market              VARCHAR(20) NOT NULL CHECK (market IN ('domestic', 'us_export', 'eu_export')),
  required_fields     JSONB NOT NULL,
  bilingual_required  BOOLEAN NOT NULL DEFAULT false,
  created_by          UUID NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS generated_labels (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  lot_id          UUID NOT NULL REFERENCES lots(id) ON DELETE RESTRICT,
  market          VARCHAR(20) NOT NULL CHECK (market IN ('domestic', 'us_export', 'eu_export')),
  label_data      JSONB NOT NULL,
  is_valid        BOOLEAN NOT NULL DEFAULT false,
  missing_fields  JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_by    UUID NOT NULL,
  generated_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE label_market_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE label_market_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE generated_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_labels FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_label_market_rules ON label_market_rules
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_generated_labels ON generated_labels
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_label_market_rules_lookup ON label_market_rules(tenant_id, market);
CREATE INDEX IF NOT EXISTS idx_generated_labels_lot ON generated_labels(tenant_id, lot_id);
