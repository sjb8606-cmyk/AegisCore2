-- signature_tokens: deliberately NOT row-level-secured.
--
-- This table exists for exactly one purpose: resolving an unguessable,
-- single-use secret token (from a public e-signature magic link) to the
-- real tenant/contract/signatory it belongs to, for a caller who has no
-- authenticated session and therefore no tenant context yet. The security
-- boundary here is possession of the token itself, not tenant scoping —
-- so this table is intentionally excluded from RLS rather than worked
-- around with a hardcoded tenant bypass value (which is what used to be
-- here, and never actually returned any rows).
--
-- Rows are deleted immediately once a token is used, and expired-but-
-- unused rows are removed by cleanupExpiredSignatureTokens() (see
-- platform/contracts/src/index.ts) so this table doesn't grow forever.

CREATE TABLE IF NOT EXISTS signature_tokens (
  token         UUID PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  contract_id   UUID NOT NULL,
  signatory_id  UUID NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signature_tokens_expires_at ON signature_tokens(expires_at);

-- No ALTER TABLE ... ENABLE ROW LEVEL SECURITY here — intentional.
