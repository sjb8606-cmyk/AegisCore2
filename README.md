# AegisCore

> **Foundational infrastructure layer for secure SaaS/AI applications.**  
> Universal Spec v3.5 compliant — SOC2, ISO 27001, GDPR/CCPA, EU AI Act ready.  
> Built by Ruthless Technologies.

---

## Quick Start

```bash
# 1. Copy environment config
cp .env.test .env
# Edit .env — set ANTHROPIC_API_KEY and other values

# 2. Start infrastructure (Postgres, Redis, LocalStack, Vault)
make docker-up

# 3. Run database migrations
make migrate

# 4. Validate all spec gates
make checklist

# 5. Validate app configs
node scripts/validate-apps.js

# 6. Start the example API
make dev

# 7. Test Delight Engine
./scripts/test-delight.sh
```

---

## Monorepo Structure

```
AegisCore/
├── platform/               # Shared infrastructure packages
│   ├── auth/               # OIDC JWT, RBAC, jti replay protection, side door
│   ├── tenancy/            # Tenant resolver, Postgres RLS
│   ├── audit/              # Immutable events, Merkle chain, S3 WORM
│   ├── queues/             # SQS client, DLQ, retry backoff
│   ├── observability/      # OTel traces + metrics, structured logging
│   ├── security/           # Vault, KMS envelope encryption, rate limiting
│   ├── metering/           # Idempotent usage ledger, billing hooks
│   ├── ai-safety/          # LLM validation, PII filter, adversarial scan
│   ├── delight/            # AI persona engine (Delight Engine core)
│   └── utils/              # Errors, pagination, ETag, HTTP responses
├── apps/
│   └── example-api/        # Auto-discovery API — mounts all route cores
├── config/
│   ├── apps/               # JSON app definitions (one file = one app)
│   │   ├── delight-engine.json
│   │   └── tidelock.json
│   ├── personas/           # Persona JSON library (business/culinary/trades/etc.)
│   └── *.json              # Per-core feature configs
├── infra/
│   ├── docker/
│   └── terraform/
├── migrations/
│   ├── sql/
│   └── seeds/
├── scripts/
│   ├── test-delight.sh     # Delight Engine curl test suite
│   ├── validate-apps.js    # App config JSON validator
│   └── export-openapi.js
├── .env.test               # Local dev environment template
├── .env.example            # Full reference (all options)
└── Makefile
```

---

## Auth Model

AegisCore uses a two-path auth system:

| Path | How | When |
|------|-----|------|
| **Standard** | OIDC JWT Bearer token via `Authorization` header | External users, production |
| **Side Door** | `x-internal-token` + `x-tenant-id` headers | Internal service-to-service, local testing |

The side door secret is environment-only (`AEGIS_INTERNAL_TOKEN`), injected from Vault in production.  
No hardcoded credentials. No dev bypasses based on `NODE_ENV`.

---

## App Creation via JSON

Drop a JSON file into `config/apps/` to define a new application:

```json
{
  "app_id": "my-app",
  "name": "My App",
  "tenant_id": "...",
  "status": "active",
  "cores": ["delight", "ai-safety", "metering"],
  "config": { "delight": { "enabled": true } },
  "routes": [{ "path": "/api/delight/chat", "method": "POST", "auth": true }]
}
```

Validate: `node scripts/validate-apps.js`

---

## Mandatory Spec Gates

Run `make checklist` to verify all Universal Spec v3.5 gates.

| Gate | Description |
|------|-------------|
| ENC-01/02 | KMS encryption at rest + TLS in transit |
| OTEL-01/02 | OpenTelemetry traces + metrics |
| SBOM-01/02 | SBOM generation + cosign image signing |
| AUDIT-01/02 | S3 WORM shipper + Merkle chain |
| RLS-01/02 | Postgres RLS + isolation tests |
| QUEUE-01/02 | SQS success-only delete + DLQ handler |
| AUTH-01/02 | jti replay protection + OIDC middleware |
| AI-01/02/03 | LLM validator + PII filter + adversarial scan |
| SEC-01/02 | Secrets policy + Vault client |
| RATE-01 | Redis rate limiter on public routes |
| HEALTH-01 | /health + /ready endpoints |
| METER-01 | Usage metering kernel |

---

## License

Proprietary — All rights reserved. © Ruthless Technologies.
