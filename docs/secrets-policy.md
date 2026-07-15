# Secrets Policy — platform-core

**Classification:** CONFIDENTIAL  
**Owner:** Platform Security Team  
**Review:** Quarterly

---

## 1. Secret Storage

| Secret Type            | Storage          | Access Method          |
|------------------------|------------------|------------------------|
| DB credentials         | Vault KV v2      | AppRole → getSecret()  |
| SQS / AWS creds        | IAM Role (ECS)   | Instance metadata      |
| KMS key                | AWS KMS          | IAM Role               |
| OIDC client secret     | Vault KV v2      | AppRole                |
| Internal service secret| Vault KV v2      | AppRole                |
| Billing webhook secret | Vault KV v2      | AppRole                |

**Rule:** No secrets in environment variables in production.  
**Rule:** No secrets in code, config files, or container images.  
**Rule:** No secrets in logs (pino redact list covers known fields).

---

## 2. Vault Configuration

### AppRole Auth (recommended for services)

```bash
# Enable AppRole
vault auth enable approle

# Create platform-core policy
vault policy write platform-core - <<EOF
path "secret/data/platform/*" {
  capabilities = ["read", "list"]
}
path "secret/data/platform/db-credentials" {
  capabilities = ["read"]
}
EOF

# Create role
vault write auth/approle/role/platform-core \
  token_policies="platform-core" \
  token_ttl=1h \
  token_max_ttl=4h \
  secret_id_ttl=720h \
  secret_id_num_uses=0

# Get role-id and secret-id (store in CI/CD secrets)
vault read auth/approle/role/platform-core/role-id
vault write -f auth/approle/role/platform-core/secret-id
```

### Token renewal

The Vault client (`platform/security/src/vault.ts`) auto-renews tokens
60 seconds before expiry. If renewal fails, it re-authenticates via AppRole.

---

## 3. KMS Envelope Encryption

### Key hierarchy

```
AWS KMS Master Key  (alias/platform-core)
  └─ GenerateDataKey() → 256-bit DEK (plaintext + encrypted)
       ├─ Plaintext DEK  → AES-256-GCM encrypt in memory → zeroed after use
       └─ Encrypted DEK  → stored alongside ciphertext
```

### Rotation

KMS master key auto-rotation is enabled (annual, AWS-managed).  
For immediate rotation: `make vault-rotate` (triggers `scripts/vault-rotate.js`).

### Test rotation in CI

```bash
# scripts/vault-rotate.js runs:
# 1. getSecret(path) — record current value hash
# 2. rotateSecret(path)
# 3. getSecret(path) — verify new value readable
# 4. assert old plaintext DEK can no longer decrypt (for KMS rotation)
```

---

## 4. Rotation Schedule

| Secret                   | Rotation Period | Method                      | Owner            |
|--------------------------|-----------------|-----------------------------|------------------|
| DB passwords             | 90 days         | Vault dynamic creds / manual| DBA              |
| Internal service secret  | 30 days         | Automated via vault-rotate  | Platform Eng     |
| Billing webhook secret   | 90 days         | Manual + bilateral confirm  | Finance + Eng    |
| KMS master key           | Annual          | AWS auto-rotation           | AWS              |
| Vault AppRole secret-id  | 30 days         | CI/CD rotation job          | Platform Eng     |
| cosign signing key       | Annual          | Keyless OIDC (no rotation)  | Platform Eng     |
| OIDC client secret       | 180 days        | IdP admin console           | Identity Team    |

---

## 5. Dual-Control (REGULATED profile)

For `COMPLIANCE_PROFILE=REGULATED`, secret access and rotation require quorum:

- Vault Shamir key shares: `vault operator init -key-shares=5 -key-threshold=3`
- Rotation operations require approval from 2 of: Security Lead, CISO, Platform Lead
- All access logged to immutable audit trail (S3 WORM)

---

## 6. Emergency Procedures

### Suspected compromise

```bash
# 1. Immediately revoke all tokens for the role
vault token revoke -accessor <accessor>

# 2. Rotate AppRole secret-id
vault write -f auth/approle/role/platform-core/secret-id

# 3. Rotate the affected secret
make vault-rotate

# 4. Audit access logs
aws s3 cp s3://platform-audit-worm/audit/ ./audit-dump/ --recursive

# 5. Page on-call security
```

### Vault seal / unavailable

The application falls back to cached secrets (5-minute TTL in memory).
After cache expiry, requests that need new secrets will fail with 503.

See: `docs/runbooks/vault-outage.md`

---

## 7. Compliance References

- SOC2 CC6.1, CC6.6, CC6.7 — Logical access, encryption, key management  
- ISO 27001 A.10 — Cryptographic controls  
- GDPR Art. 32 — Security of processing (encryption at rest + in transit)
