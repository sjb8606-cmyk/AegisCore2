CREATE TABLE IF NOT EXISTS guest_count_menu_planning (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  event_id UUID NOT NULL,
  guest_count INTEGER NOT NULL DEFAULT 0
    CHECK (guest_count >= 0),
  menu_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  dietary_restriction_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT guest_count_menu_event_unique
    UNIQUE (tenant_id, event_id)
);

ALTER TABLE guest_count_menu_planning
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE guest_count_menu_planning
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_guest_count_menu_planning
  ON guest_count_menu_planning
  USING (
    tenant_id =
    current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    tenant_id =
    current_setting('app.tenant_id', true)::uuid
  );

CREATE INDEX IF NOT EXISTS idx_guest_menu_tenant_event
  ON guest_count_menu_planning (tenant_id, event_id);
