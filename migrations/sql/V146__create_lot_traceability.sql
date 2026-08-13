CREATE TABLE IF NOT EXISTS lots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  lot_code          VARCHAR(100) NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'held', 'released', 'consumed', 'closed')),
  source_type       VARCHAR(20) NOT NULL
                      CHECK (source_type IN ('harvest', 'shipment', 'purchase', 'batch', 'other')),
  source_ref_table  VARCHAR(100),
  source_ref_id     UUID,
  quantity          NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  unit              VARCHAR(20) NOT NULL,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by        UUID NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  closed_at         TIMESTAMPTZ,
  deleted_at        TIMESTAMPTZ,
  UNIQUE(tenant_id, lot_code)
);

-- Append-only, hash-chained event log for every lot mutation.
CREATE TABLE IF NOT EXISTS lot_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  lot_id      UUID NOT NULL REFERENCES lots(id) ON DELETE RESTRICT,
  event_type  VARCHAR(30) NOT NULL
                CHECK (event_type IN ('created', 'split', 'merged', 'transformed', 'held', 'released', 'shipped', 'received', 'closed')),
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id    UUID NOT NULL,
  prev_hash   CHAR(64) NOT NULL,
  hash        CHAR(64) NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Lineage graph edges — the structure traceUpstream/traceDownstream walk.
CREATE TABLE IF NOT EXISTS lot_relationships (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  parent_lot_id      UUID NOT NULL REFERENCES lots(id) ON DELETE RESTRICT,
  child_lot_id       UUID NOT NULL REFERENCES lots(id) ON DELETE RESTRICT,
  relationship_type  VARCHAR(20) NOT NULL CHECK (relationship_type IN ('split', 'merge', 'transform')),
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, parent_lot_id, child_lot_id)
);

ALTER TABLE lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE lots FORCE ROW LEVEL SECURITY;
ALTER TABLE lot_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE lot_events FORCE ROW LEVEL SECURITY;
ALTER TABLE lot_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE lot_relationships FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_lots ON lots
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_lot_events ON lot_events
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_lot_relationships ON lot_relationships
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_lots_tenant ON lots(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lots_status ON lots(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lots_source_ref ON lots(tenant_id, source_ref_table, source_ref_id);

CREATE INDEX IF NOT EXISTS idx_lot_events_lot ON lot_events(tenant_id, lot_id, created_at);

CREATE INDEX IF NOT EXISTS idx_lot_relationships_parent ON lot_relationships(tenant_id, parent_lot_id);
CREATE INDEX IF NOT EXISTS idx_lot_relationships_child ON lot_relationships(tenant_id, child_lot_id);
