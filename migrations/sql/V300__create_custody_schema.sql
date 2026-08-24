-- ============================================================
-- Golden Key · Digital Custody Schema (Layer 1)
-- ============================================================
-- Design goals:
--   1. Explicit vault + asset model (not the old vault_secrets KV shape)
--   2. Sealed-state enforcement will be applied in the core (not triggers)
--   3. custody_events is an append-only ledger; hashes via @platform/hash-chain
--   4. Classical crypto only (content hashes = SHA-256)
--   5. Object/blob storage pointer (storage_key) — payload lives outside DB
-- ============================================================

-- ── Vaults ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS custody_vaults (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  owner_id        UUID NOT NULL,
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  -- open | sealed | released | archived | destroyed
  state           VARCHAR(32) NOT NULL DEFAULT 'open',
  -- Optional policy document (JSON) for later multi-party / estate rules
  policy          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sealed_at       TIMESTAMPTZ,
  released_at     TIMESTAMPTZ,
  destroyed_at    TIMESTAMPTZ,

  CONSTRAINT custody_vaults_state_check
    CHECK (state IN ('open', 'sealed', 'released', 'archived', 'destroyed')),
  CONSTRAINT custody_vaults_tenant_name_unique
    UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_custody_vaults_tenant_owner
  ON custody_vaults (tenant_id, owner_id);

CREATE INDEX IF NOT EXISTS idx_custody_vaults_tenant_state
  ON custody_vaults (tenant_id, state);

ALTER TABLE custody_vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE custody_vaults FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_custody_vaults ON custody_vaults;
CREATE POLICY tenant_isolation_custody_vaults ON custody_vaults
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- ── Assets ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS custody_assets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  vault_id        UUID NOT NULL REFERENCES custody_vaults(id),
  -- Human label
  name            VARCHAR(512) NOT NULL,
  content_type    VARCHAR(255),
  byte_size       BIGINT,
  -- SHA-256 hex of plaintext content (computed at deposit, before encryption)
  content_hash    CHAR(64) NOT NULL,
  -- Envelope encryption metadata (from @platform/security encryptField / KMS)
  -- Store the encrypted blob elsewhere; DB holds the envelope + pointer only
  encrypted_envelope JSONB NOT NULL,
  -- Object storage key (S3 / equivalent). Never store large payloads in DB.
  storage_key     TEXT NOT NULL,
  -- open | sealed | released | destroyed
  state           VARCHAR(32) NOT NULL DEFAULT 'open',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sealed_at       TIMESTAMPTZ,
  destroyed_at    TIMESTAMPTZ,

  CONSTRAINT custody_assets_state_check
    CHECK (state IN ('open', 'sealed', 'released', 'destroyed')),
  CONSTRAINT custody_assets_hash_format
    CHECK (content_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_custody_assets_tenant_vault
  ON custody_assets (tenant_id, vault_id);

CREATE INDEX IF NOT EXISTS idx_custody_assets_content_hash
  ON custody_assets (tenant_id, content_hash);

CREATE INDEX IF NOT EXISTS idx_custody_assets_state
  ON custody_assets (tenant_id, state);

ALTER TABLE custody_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE custody_assets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_custody_assets ON custody_assets;
CREATE POLICY tenant_isolation_custody_assets ON custody_assets
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- ── Custody Events (append-only ledger) ──────────────────────
-- Hash chaining: use @platform/hash-chain
--   computeChainHash(scopeId, eventType, payload, previousHash)
--   GENESIS_HASH for the first event in a scope
-- scope_id is typically the vault_id (or asset_id for asset-local chains)
CREATE TABLE IF NOT EXISTS custody_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  -- Chain scope (usually vault_id)
  scope_id        UUID NOT NULL,
  -- Optional tighter binding
  vault_id        UUID REFERENCES custody_vaults(id),
  asset_id        UUID REFERENCES custody_assets(id),
  -- Event classification
  event_type      VARCHAR(64) NOT NULL,
  -- Actor
  actor_id        UUID NOT NULL,
  actor_type      VARCHAR(16) NOT NULL DEFAULT 'user',
  -- Opaque payload (must be JSON-serializable; used in hash computation)
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Hash chain fields (from @platform/hash-chain)
  previous_hash   CHAR(64) NOT NULL,
  event_hash      CHAR(64) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT custody_events_actor_type_check
    CHECK (actor_type IN ('user', 'service', 'system')),
  CONSTRAINT custody_events_prev_hash_format
    CHECK (previous_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT custody_events_event_hash_format
    CHECK (event_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_custody_events_scope_created
  ON custody_events (tenant_id, scope_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_custody_events_vault
  ON custody_events (tenant_id, vault_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_custody_events_asset
  ON custody_events (tenant_id, asset_id, created_at ASC);

ALTER TABLE custody_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE custody_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_custody_events ON custody_events;
CREATE POLICY tenant_isolation_custody_events ON custody_events
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- ── Notes (not enforced in SQL — documented for the core) ────
-- * Append-only: cores must only INSERT into custody_events, never UPDATE/DELETE.
-- * Sealed enforcement: custody-vault core rejects mutate/delete when state=sealed.
-- * Destroyed: cryptographic erasure of DEKs + storage object; row retained for provenance.
-- * content_hash is over plaintext, computed client-side or in the deposit core
--   before encryption. Verification = re-hash plaintext and compare.
