# AegisCore Integration / Capability Infrastructure

## Status

Implementation branch: `integration-capability-infrastructure`

This work is foundational platform infrastructure, not an MVP.

## Verified live-repository findings

- `platform/ai-gateway` is currently a provider-specific dispatch switch with Groq, ElevenLabs and D-ID adapters.
- `platform/aegis-swarm/src/employees/provider-router.ts` contains provider fallback logic but is bot-scoped.
- `platform/tool-registry` owns tool contracts, risk metadata and permission boundaries.
- `platform/audit` is the canonical audit emitter and is fail-safe.
- `platform/metering` is the canonical usage ledger and already supports idempotent usage events.
- `platform/quota-guard` owns quota comparison/enforcement.
- `platform/security` owns Vault/KMS.
- `platform/tenancy` owns the database pool and tenant/RLS access.
- `src/engines/mcpInterceptor.ts` is the existing Veridact boundary/policy/HITL interception point.
- There was no canonical general Capability -> Provider -> Adapter invocation kernel found in the inspected paths.
- There was no general provider health/circuit state or provider idempotency ledger found for this responsibility.

## Canonical dependency direction

```
Applications / feature cores / bots / agents
                    |
                    v
              Tool Registry (when invoked as a tool)
                    |
                    v
           Capability / Integration Router
                    |
             +------+------+
             |             |
      Capability       Provider Registry
       Registry             |
             +------+-------+
                    |
                 Adapter
                    |
             External Provider
```

The integration router must never depend on Tool Registry.

Tool Registry may consume capabilities.

## Implemented foundation

`platform/integration-router` now provides:

- Capability Registry
- Provider Registry
- versioned capability definitions
- provider adapter contract
- deterministic provider ordering
- allowed/requested provider constraints
- region filtering
- retry/fallback
- canonical provider error normalization
- request deadlines
- circuit-breaker state
- in-memory and PostgreSQL health stores
- idempotency contract
- in-memory and PostgreSQL idempotency stores
- normalized provider result envelope
- audit integration
- metering integration
- existing AI gateway adapters registered as initial provider adapters

## Persistence

Migration:

`V901__create_integration_capability_infrastructure.sql`

Tables:

- `integration_provider_health`
- `integration_idempotency`

Provider health is global platform state.

Idempotency is tenant-scoped.

## Security rules

- No provider secrets are stored in capability/provider configuration.
- Existing environment/Vault/KMS mechanisms remain authoritative.
- Tenant identity is mandatory for every invocation.
- Actor identity is mandatory for every invocation.
- Audit uses the existing `platform/audit` pipeline.
- Usage uses the existing `platform/metering` ledger.
- Veridact remains the policy/HITL/receipt boundary for operations that require it.

## Idempotency rule

Capabilities declare:

- `none`
- `optional`
- `required`

State-changing capabilities should use `required`.

The router stores invocation state before provider execution and returns the stored result on replay.

Provider-specific idempotency-key forwarding remains an adapter responsibility where the external provider supports it.

## Versioning rule

Capabilities are addressed as:

`capability-id@vN`

The registry supports multiple versions simultaneously.

A provider implements one or more capability IDs; provider-specific wire formats stay inside adapters.

## Remaining construction phases

1. Compile/test the new kernel against the live workspace.
2. Harden router timeout/cancellation semantics and failure classification.
3. Add provider health probing and operational health reporting.
4. Add deterministic selection policy model beyond static priority.
5. Add provider credential resolver abstraction for env/Vault/KMS and tenant-owned credentials.
6. Add capability/tool bridge in the Tool Registry direction without creating a dependency cycle.
7. Integrate Veridact/MCP interception for capabilities marked as requiring policy/HITL.
8. Generalize existing E-38 fallback behavior onto the canonical router and migrate callers.
9. Add shared outbound HTTP transport policy where it materially reduces duplicated provider HTTP behavior.
10. Expand adapters by capability category.
11. Add provider cost/latency metadata and deterministic routing policies.
12. Add regional/data-residency constraints.
13. Add comprehensive failure, concurrency, tenant-isolation and migration regression suites.
14. Migrate existing direct outbound paths.
15. Retire duplicate routing paths only after consumers are migrated.
16. Produce final completion/learning artifact and have Claude perform a full branch review before merge.

## Provider #501 acceptance test

Adding a provider must require only:

1. Provider definition
2. Adapter
3. Capability mappings
4. Credential configuration
5. Normalization/error mapping
6. Provider tests
7. Registration

The core router, audit, metering, tenancy, security and consuming applications must not require provider-specific changes.

## Non-goals

This branch does not attempt to implement hundreds of external providers immediately.

It builds the complete reusable infrastructure that makes those additions routine.
