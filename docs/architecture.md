# Architecture — platform-core

## Overview

`platform-core` is the foundational infrastructure monorepo for all SaaS/AI applications
on this platform. It contains no business domain logic — only shared infrastructure concerns.

---

## System Context

```
┌──────────────────────────────────────────────────────────────────┐
│                        Internet / Clients                        │
└────────────────────────────┬─────────────────────────────────────┘
                             │ HTTPS (TLS 1.3)
                     ┌───────▼────────┐
                     │  Load Balancer │  (AWS ALB / CloudFront)
                     └───────┬────────┘
                             │
              ┌──────────────▼───────────────┐
              │       example-api (ECS)       │
              │  ┌──────────────────────────┐ │
              │  │  OTel │ Auth │ RateLimit  │ │
              │  │  Tenancy │ Validation    │ │
              │  └──────────────────────────┘ │
              └──┬──────────┬────────┬────────┘
                 │          │        │
         ┌───────▼──┐  ┌────▼───┐  ┌▼──────┐
         │ Postgres │  │ Redis  │  │  SQS  │
         │ (RLS on) │  │ Cache  │  │ + DLQ │
         └──────────┘  └────────┘  └───┬───┘
                                       │
                               ┌───────▼────────┐
                               │  Audit Worker  │
                               │ (SQS Consumer) │
                               └───────┬────────┘
                                       │ PutObject
                               ┌───────▼────────┐
                               │  S3 WORM Bucket │
                               │ (Object Lock)   │
                               └────────────────┘
```

---

## Package Map

| Package                  | Responsibility                                        |
|--------------------------|-------------------------------------------------------|
| `@platform/auth`         | OIDC verification, JWT validation, jti replay, RBAC  |
| `@platform/tenancy`      | Tenant resolution, Postgres RLS, async context       |
| `@platform/audit`        | Immutable event schema, Merkle chain, S3 shipper     |
| `@platform/queues`       | SQS client, DLQ handler, exponential backoff         |
| `@platform/observability`| OTel traces + metrics, structured logging            |
| `@platform/security`     | Vault, KMS envelope encryption, rate limiting        |
| `@platform/metering`     | Idempotent usage ledger, billing hooks               |
| `@platform/ai-safety`    | LLM output validation, PII filter, adversarial scan  |
| `@platform/utils`        | Error framework, pagination, ETag, HTTP responses    |

---

## Authentication Flow

```
Client
  │
  │  1. GET /api/items
  │     Authorization: Bearer <JWT>
  ▼
requireAuth() middleware
  │
  │  2. verifyOidcToken(token)
  │     - fetch JWKS from provider (cached 10 min)
  │     - validate issuer, audience, algorithm, expiry
  │     - extract jti, sub, tenant_id, roles
  │
  │  3. checkReplay(jti)
  │     - SET jti:seen:<jti> NX EX <ttl> in Redis
  │     - if result==null → replay detected → 401
  │
  │  4. bindTenantToRequest(tenantId)
  │     - AsyncLocalStorage.run({ tenantId })
  │
  ▼
tenantResolver() middleware
  │
  │  5. validate tenantId format
  │
  ▼
Business handler
  │
  │  6. withTenantTransaction(client => ...)
  │     - set_config('app.current_tenant_id', tenantId)
  │     - Postgres RLS enforces isolation automatically
  │
  ▼
Response
```

---

## Async Queue Flow (Success-Only Delete)

```
Producer (API handler)
  │
  │  enqueue({ body, queueUrl, deduplicationId })
  ▼
SQS FIFO Queue
  │
  │  (SQS retains message; visibility timeout hides it)
  ▼
Consumer (Worker process)
  │
  │  receiveMessages() — long polling, 20s wait
  │
  ├─ handler(message) ──► SUCCESS
  │                            │
  │                            ▼
  │                       deleteMessage()  ✅ only on success
  │
  └─ handler(message) ──► FAILURE
                               │
                               │  Do NOT delete
                               ▼
                          Visibility timeout expires
                               │
                               ▼
                          SQS re-delivers (up to maxReceiveCount=3)
                               │
                               ▼
                          Dead-Letter Queue (DLQ)
                               │
                               ▼
                          DLQ Handler: log + archive + alert
```

---

## Tenancy & RLS

Every table in the application schema has:
1. A `tenant_id UUID NOT NULL` column.
2. An RLS policy: `USING (tenant_id = current_setting('app.current_tenant_id')::uuid)`
3. `FORCE ROW LEVEL SECURITY` to prevent bypass by table owner.

The session variable is set per-connection via `set_config()` before any query.
This means even if application code has a bug, Postgres will reject cross-tenant data access.

---

## Audit Chain (Merkle-linked WORM)

```
Event N-1                    Event N
┌─────────────────┐          ┌─────────────────┐
│ id: uuid        │          │ id: uuid        │
│ action: ...     │──SHA256──►│ _prevHash: ...  │
│ _hash: H(N-1)   │          │ _hash: H(N)     │
│ _sequence: N-1  │          │ _sequence: N    │
└─────────────────┘          └─────────────────┘
         │                            │
         ▼                            ▼
   S3 WORM Object              S3 WORM Object
   (COMPLIANCE mode,           (COMPLIANCE mode,
    7-year retention)           7-year retention)
```

Tampering with any event invalidates all subsequent hashes.
`verifyChain()` re-computes every hash and checks chain linkage.

---

## Secrets Hierarchy

```
AWS KMS (HSM-backed)
  └── Envelope Key (alias/platform-core)
       └── Data Encryption Keys (DEK) — generated per encrypt call
            └── Encrypted ciphertext stored in DB / S3

HashiCorp Vault (AppRole auth)
  └── KV v2 mount (secret/)
       ├── platform/db-credentials
       ├── platform/sqs-credentials
       ├── platform/internal-service-secret
       └── platform/billing-webhook-secret
```

---

## Compliance Profile

| Control                  | BASELINE        | REGULATED                      |
|--------------------------|-----------------|--------------------------------|
| Encryption at rest       | KMS AES-256-GCM | KMS + HSM + field-level        |
| Audit retention          | 1 year WORM     | 7 year WORM + QLDB             |
| MFA                      | Required for ops| Required for all users         |
| Secret rotation          | 90 days         | 30 days + dual-control         |
| Penetration testing      | Annual          | Quarterly                      |
| Compliance frameworks    | SOC2 Type I     | SOC2 Type II + ISO 27001 + GDPR|

Set `COMPLIANCE_PROFILE=REGULATED` in environment to enable stricter controls.
