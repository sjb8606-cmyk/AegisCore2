DROP TABLE IF EXISTS vet_medical_events CASCADE;
DROP TABLE IF EXISTS vet_treatments CASCADE;
DROP TABLE IF EXISTS vet_vaccinations CASCADE;
DROP TABLE IF EXISTS vet_patients CASCADE;

CREATE TABLE vet_patients (
  id             UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  owner_id       UUID NOT NULL,
  name           VARCHAR(100) NOT NULL,
  species        VARCHAR(50) NOT NULL,
  breed          VARCHAR(100),
  date_of_birth  DATE,
  sex            VARCHAR(20) CHECK (sex IN ('male', 'female', 'neutered_male', 'spayed_female', 'unknown')),
  microchip_id   VARCHAR(100),
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE vet_vaccinations (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  patient_id        UUID NOT NULL REFERENCES vet_patients(id) ON DELETE CASCADE,
  vaccine_name      VARCHAR(150) NOT NULL,
  administered_at   DATE NOT NULL,
  next_due_at       DATE NOT NULL,
  administrator_id  UUID NOT NULL,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE vet_treatments (
  id               UUID PRIMARY KEY,
  tenant_id        UUID NOT NULL,
  patient_id       UUID NOT NULL REFERENCES vet_patients(id) ON DELETE CASCADE,
  title            VARCHAR(255) NOT NULL,
  status           VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'canceled')),
  diagnostic_notes TEXT,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Append-only medical event ledger for medical compliance and safety audits
CREATE TABLE vet_medical_events (
  id          UUID PRIMARY KEY,
  tenant_id   UUID NOT NULL,
  patient_id  UUID NOT NULL REFERENCES vet_patients(id) ON DELETE CASCADE,
  event_type  VARCHAR(100) NOT NULL,
  log_message TEXT NOT NULL,
  logged_by   UUID NOT NULL,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE vet_patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE vet_vaccinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE vet_treatments ENABLE ROW LEVEL SECURITY;
ALTER TABLE vet_medical_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_patients ON vet_patients USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_vaccinations ON vet_vaccinations USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_treatments ON vet_treatments USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_vet_events ON vet_medical_events USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_vet_patients_owner ON vet_patients(tenant_id, owner_id);
CREATE INDEX IF NOT EXISTS idx_vet_vaccinations_patient ON vet_vaccinations(patient_id);
CREATE INDEX IF NOT EXISTS idx_vet_events_patient ON vet_medical_events(patient_id, created_at);
