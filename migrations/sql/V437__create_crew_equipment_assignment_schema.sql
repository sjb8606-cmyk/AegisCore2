CREATE TABLE crew_equipment_assignments (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  visit_id UUID NOT NULL,
  crew_member_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  equipment_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL CHECK (
    status IN (
      'assigned',
      'in_progress',
      'completed'
    )
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_crew_equipment_assignments_tenant_visit
  ON crew_equipment_assignments (tenant_id, visit_id);

CREATE INDEX idx_crew_equipment_assignments_tenant_status
  ON crew_equipment_assignments (tenant_id, status);

ALTER TABLE crew_equipment_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew_equipment_assignments FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_crew_equipment_assignments
  ON crew_equipment_assignments
  USING (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id =
      current_setting('app.tenant_id')::uuid
  );
