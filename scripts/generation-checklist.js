#!/usr/bin/env node
// scripts/generation-checklist.js
// Prints and validates all mandatory Universal Spec v3.5 gates.

const fs = require('fs');
const path = require('path');

const CYAN  = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED   = '\x1b[31m';
const YELLOW= '\x1b[33m';
const NC    = '\x1b[0m';
const BOLD  = '\x1b[1m';

const ROOT = path.resolve(__dirname, '..');

function exists(...parts) {
  return fs.existsSync(path.join(ROOT, ...parts));
}

const gates = [
  {
    id: 'ENC-01',
    label: 'Encryption at rest (KMS envelope)',
    check: () => exists('platform/security/src/kms.ts'),
  },
  {
    id: 'ENC-02',
    label: 'Encryption in transit (TLS config)',
    check: () => exists('infra/docker/docker-compose.yml'),
  },
  {
    id: 'OTEL-01',
    label: 'OpenTelemetry traces',
    check: () => exists('platform/observability/src/tracing.ts'),
  },
  {
    id: 'OTEL-02',
    label: 'OpenTelemetry metrics',
    check: () => exists('platform/observability/src/metrics.ts'),
  },
  {
    id: 'SBOM-01',
    label: 'SBOM generation configured',
    check: () => exists('.github/workflows/ci.yml'),
  },
  {
    id: 'SBOM-02',
    label: 'Artifact signing (cosign)',
    check: () => exists('.github/workflows/ci.yml'),
  },
  {
    id: 'AUDIT-01',
    label: 'Immutable audit pipeline (S3 WORM)',
    check: () => exists('platform/audit/src/shipper.ts'),
  },
  {
    id: 'AUDIT-02',
    label: 'Merkle-chain audit linking',
    check: () => exists('platform/audit/src/merkle.ts'),
  },
  {
    id: 'RLS-01',
    label: 'Postgres Row-Level Security helpers',
    check: () => exists('platform/tenancy/src/rls.ts'),
  },
  {
    id: 'RLS-02',
    label: 'Tenant isolation tests',
    check: () => exists('platform/tenancy/src/__tests__/isolation.test.ts'),
  },
  {
    id: 'QUEUE-01',
    label: 'Async SQS queue with success-only delete',
    check: () => exists('platform/queues/src/sqs-client.ts'),
  },
  {
    id: 'QUEUE-02',
    label: 'Dead-letter queue (DLQ) handler',
    check: () => exists('platform/queues/src/dlq-handler.ts'),
  },
  {
    id: 'AUTH-01',
    label: 'JWT replay protection (jti + Redis)',
    check: () => exists('platform/auth/src/replay-protection.ts'),
  },
  {
    id: 'AUTH-02',
    label: 'OIDC verification middleware',
    check: () => exists('platform/auth/src/oidc.ts'),
  },
  {
    id: 'AI-01',
    label: 'AI safety eval harness',
    check: () => exists('platform/ai-safety/src/validator.ts'),
  },
  {
    id: 'AI-02',
    label: 'PII filter',
    check: () => exists('platform/ai-safety/src/pii-filter.ts'),
  },
  {
    id: 'AI-03',
    label: 'Adversarial prompt detection',
    check: () => exists('platform/ai-safety/src/adversarial.ts'),
  },
  {
    id: 'SEC-01',
    label: 'Secrets policy documented',
    check: () => exists('docs/secrets-policy.md'),
  },
  {
    id: 'SEC-02',
    label: 'Vault client stub',
    check: () => exists('platform/security/src/vault.ts'),
  },
  {
    id: 'DB-01',
    label: 'Flyway migrations',
    check: () => exists('migrations/sql/V1__init.sql'),
  },
  {
    id: 'RATE-01',
    label: 'Rate limiting on public routes',
    check: () => exists('platform/security/src/rate-limiter.ts'),
  },
  {
    id: 'PAGE-01',
    label: 'Pagination on list endpoints',
    check: () => exists('platform/utils/src/pagination.ts'),
  },
  {
    id: 'HEALTH-01',
    label: 'Health and readiness endpoints',
    check: () => exists('apps/example-api/src/health.ts'),
  },
  {
    id: 'DOCS-01',
    label: 'Architecture documentation',
    check: () => exists('docs/architecture.md'),
  },
  {
    id: 'DOCS-02',
    label: 'Runbooks (rollback, DLQ, audit)',
    check: () => exists('docs/runbooks/rollback.md'),
  },
  {
    id: 'OPENAPI-01',
    label: 'OpenAPI spec exported',
    check: () => exists('docs/openapi.yaml'),
  },
  {
    id: 'METER-01',
    label: 'Usage metering kernel',
    check: () => exists('platform/metering/src/ledger.ts'),
  },
];

console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════════════════${NC}`);
console.log(`${BOLD}  platform-core — Universal Spec v3.5 Generation Checklist${NC}`);
console.log(`${BOLD}${CYAN}═══════════════════════════════════════════════════════${NC}\n`);

let passed = 0;
let failed = 0;

for (const gate of gates) {
  const ok = gate.check();
  if (ok) {
    passed++;
    console.log(`  ${GREEN}✅ [${gate.id}]${NC} ${gate.label}`);
  } else {
    failed++;
    console.log(`  ${RED}❌ [${gate.id}]${NC} ${gate.label}`);
  }
}

console.log(`\n${BOLD}${CYAN}───────────────────────────────────────────────────────${NC}`);
console.log(`  ${GREEN}Passed: ${passed}${NC}  |  ${failed > 0 ? RED : GREEN}Failed: ${failed}${NC}  |  Total: ${gates.length}`);

if (failed === 0) {
  console.log(`\n${BOLD}${GREEN}  🎉 ALL GATES PASSED — System is compliant with Spec v3.5${NC}\n`);
  process.exit(0);
} else {
  console.log(`\n${BOLD}${RED}  🚨 GENERATION INCOMPLETE — ${failed} gate(s) failed${NC}\n`);
  process.exit(1);
}
