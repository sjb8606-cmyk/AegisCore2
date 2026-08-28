CREATE TABLE IF NOT EXISTS marina_fuel_tank (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  label TEXT NOT NULL,
  grade TEXT NOT NULL,
  capacity_liters NUMERIC NOT NULL,
  book_liters NUMERIC NOT NULL
);
CREATE TABLE IF NOT EXISTS marina_fuel_delivery (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  tank_id UUID NOT NULL,
  liters NUMERIC NOT NULL,
  delivered_at TIMESTAMPTZ NOT NULL,
  supplier_ref TEXT
);
CREATE TABLE IF NOT EXISTS marina_fuel_sale (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  tank_id UUID NOT NULL,
  liters NUMERIC NOT NULL,
  sold_at TIMESTAMPTZ NOT NULL,
  pump_id TEXT
);
CREATE TABLE IF NOT EXISTS marina_fuel_stick (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  tank_id UUID NOT NULL,
  liters NUMERIC NOT NULL,
  read_at TIMESTAMPTZ NOT NULL,
  actor_id TEXT NOT NULL
);
