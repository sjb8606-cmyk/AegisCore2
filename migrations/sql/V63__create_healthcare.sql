-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS medications CASCADE;
DROP TABLE IF EXISTS intake_forms CASCADE;
DROP TABLE IF EXISTS consent_records CASCADE;
DROP TABLE IF EXISTS clinical_notes CASCADE;
DROP TABLE IF EXISTS patients CASCADE;

CREATE TABLE patients (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  mrn               VARCHAR(50) UNIQUE,
  first_name        VARCHAR(100) NOT NULL,
  last_name         VARCHAR(100) NOT NULL,
  date_of_birth     DATE NOT NULL,
  gender            VARCHAR(20),
  email             VARCHAR(255),
  phone             VARCHAR(50),
  address           JSONB DEFAULT '{}',
  emergency_contact JSONB DEFAULT '{}',
  insurance         JSONB DEFAULT '{}',
  status            VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','inactive','deceased','transferred')),
  encrypted_data    TEXT NOT NULL,
  assigned_to       UUID,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at        TIMESTAMP WITH TIME ZONE
);

CREATE TABLE clinical_notes (
  id             UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  patient_id     UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  authored_by    UUID NOT NULL,
  note_type      VARCHAR(50) NOT NULL CHECK (note_type IN ('soap','progress','intake','discharge','referral','other')),
  encrypted_body TEXT NOT NULL,
  is_signed      BOOLEAN DEFAULT FALSE,
  signed_at      TIMESTAMP WITH TIME ZONE,
  signed_by      UUID,
  appointment_id UUID,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE consent_records (
  id            UUID PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  patient_id    UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  consent_type  VARCHAR(50) NOT NULL,
  version       VARCHAR(20) NOT NULL,
  granted       BOOLEAN NOT NULL,
  signed_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  expires_at    TIMESTAMP WITH TIME ZONE,
  signature_data TEXT,
  ip_address    INET,
  witnessed_by  UUID,
  revoked_at    TIMESTAMP WITH TIME ZONE,
  metadata      JSONB DEFAULT '{}'
);

CREATE TABLE intake_forms (
  id            UUID PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  patient_id    UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  form_type     VARCHAR(50) NOT NULL,
  encrypted_data TEXT NOT NULL,
  completed_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  reviewed_by   UUID,
  reviewed_at   TIMESTAMP WITH TIME ZONE
);

CREATE TABLE medications (
  id            UUID PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  patient_id    UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  name          VARCHAR(255) NOT NULL,
  dosage        VARCHAR(100),
  frequency     VARCHAR(100),
  prescribed_by UUID,
  start_date    DATE,
  end_date      DATE,
  is_active     BOOLEAN DEFAULT TRUE,
  notes         TEXT,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE medications ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_patients ON patients USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_notes ON clinical_notes USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_consent ON consent_records USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_intake ON intake_forms USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_meds ON medications USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_patients_tenant ON patients(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notes_patient ON clinical_notes(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consent_patient ON consent_records(patient_id, consent_type);
CREATE INDEX IF NOT EXISTS idx_meds_patient ON medications(patient_id, is_active);
