CREATE TABLE rental_reservation_calendar (
  reservation_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  asset_id UUID NOT NULL,
  client_id UUID NOT NULL,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  buffer_hours_after NUMERIC(10,2) NOT NULL DEFAULT 0
    CHECK (buffer_hours_after >= 0),
  status TEXT NOT NULL
    CHECK (
      status IN (
        'reserved',
        'active',
        'returned',
        'cancelled'
      )
    ),
  CHECK (start_date < end_date)
);

CREATE INDEX idx_rental_reservation_calendar_tenant_asset_dates
  ON rental_reservation_calendar (
    tenant_id,
    asset_id,
    start_date,
    end_date
  );

ALTER TABLE rental_reservation_calendar
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE rental_reservation_calendar
  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_rental_reservation_calendar
  ON rental_reservation_calendar
  USING (
    tenant_id = current_setting('app.tenant_id')::uuid
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id')::uuid
  );
