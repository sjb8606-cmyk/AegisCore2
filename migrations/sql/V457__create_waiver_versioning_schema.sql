CREATE TABLE IF NOT EXISTS fit_waiver_version (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  version TEXT NOT NULL,
  title TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  effective_at TIMESTAMPTZ NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fit_waiver_version
  ON fit_waiver_version(tenant_id, version);
CREATE TABLE IF NOT EXISTS fit_waiver_signature (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  member_id TEXT NOT NULL,
  waiver_version_id UUID NOT NULL,
  version TEXT NOT NULL,
  signed_at TIMESTAMPTZ NOT NULL,
  signature_ref TEXT NOT NULL,
  actor_id TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fit_waiver_sig
  ON fit_waiver_signature(tenant_id, member_id, waiver_version_id);
