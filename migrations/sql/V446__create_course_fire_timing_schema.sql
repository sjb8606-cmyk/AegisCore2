CREATE TABLE IF NOT EXISTS rest_course_ticket (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  order_id UUID NOT NULL,
  table_label TEXT,
  courses JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_course_ticket_order
  ON rest_course_ticket(tenant_id, order_id);
