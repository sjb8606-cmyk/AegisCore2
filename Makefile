# ─────────────────────────────────────────────────────────────
# platform-core Makefile
# Usage: make <target>
# ─────────────────────────────────────────────────────────────

.PHONY: help build test lint typecheck migrate docker-up docker-down \
        docker-logs sbom sign openapi checklist clean dev seed \
        test-isolation test-auth test-audit test-queue test-ai \
        vault-init redis-flush health

SHELL := /bin/bash
ROOT_DIR := $(shell pwd)
IMAGE_NAME ?= platform-core
IMAGE_TAG  ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo "dev")

# ── Colors ────────────────────────────────────────────────────
CYAN  := \033[0;36m
GREEN := \033[0;32m
RED   := \033[0;31m
NC    := \033[0m

help: ## Show this help
	@echo ""
	@echo "$(CYAN)platform-core — Available Targets$(NC)"
	@echo "──────────────────────────────────"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-28s$(NC) %s\n", $$1, $$2}'
	@echo ""

# ── Development ───────────────────────────────────────────────
dev: docker-up migrate ## Start full local dev environment
	@echo "$(GREEN)✅ Dev environment ready$(NC)"
	NODE_ENV=development INTERNAL_SERVICE_SECRET=founder-master-key npm run dev --workspace=apps/example-api

checklist: ## Print generation validation checklist
	@node scripts/generation-checklist.js

install: ## Install all dependencies
	npm install

build: ## Build all packages
	npm run build

clean: ## Remove build artifacts
	find . -name "dist" -type d -not -path "*/node_modules/*" | xargs rm -rf
	find . -name "*.js.map" -not -path "*/node_modules/*" | xargs rm -f
	@echo "$(GREEN)✅ Cleaned$(NC)"

# ── Testing ───────────────────────────────────────────────────
test: ## Run all tests
	npm test

test-coverage: ## Run tests with coverage report
	npm run test:coverage

test-isolation: ## Run tenant isolation tests
	npm test --workspace=platform/tenancy -- --testPathPattern=isolation

test-auth: ## Run JWT + OIDC + replay protection tests
	npm test --workspace=platform/auth

test-audit: ## Run audit immutability + Merkle tests
	npm test --workspace=platform/audit

test-queue: ## Run queue retry + DLQ tests
	npm test --workspace=platform/queues

test-ai: ## Run AI safety validation tests
	npm test --workspace=platform/ai-safety

test-rls: ## Run Postgres RLS enforcement tests
	npm test --workspace=platform/tenancy -- --testPathPattern=rls

test-rate-limit: ## Run rate limiting tests
	npm test --workspace=platform/security -- --testPathPattern=rate

# ── Code Quality ──────────────────────────────────────────────
lint: ## Run ESLint
	npm run lint

lint-fix: ## Run ESLint with auto-fix
	npm run lint:fix

typecheck: ## TypeScript type checking
	npm run typecheck

# ── Database ──────────────────────────────────────────────────
migrate: ## Run Flyway migrations
	@echo "$(CYAN)Running Flyway migrations...$(NC)"
	flyway migrate -configFiles=flyway.conf
	@echo "$(GREEN)✅ Migrations applied$(NC)"

migrate-info: ## Show migration status
	flyway info -configFiles=flyway.conf

migrate-down: ## Undo last migration (REGULATED: requires approval)
	@echo "$(RED)⚠️  Undoing last migration...$(NC)"
	flyway undo -configFiles=flyway.conf

migrate-validate: ## Validate applied migrations
	flyway validate -configFiles=flyway.conf

seed: ## Seed dev database with test data
	psql $$DATABASE_URL -f migrations/seeds/dev-seed.sql

# ── Docker ────────────────────────────────────────────────────
docker-up: ## Start all infrastructure containers
	docker compose -f infra/docker/docker-compose.yml up -d
	@echo "$(GREEN)✅ Infrastructure up$(NC)"

docker-down: ## Stop all infrastructure containers
	docker compose -f infra/docker/docker-compose.yml down

docker-logs: ## Tail container logs
	docker compose -f infra/docker/docker-compose.yml logs -f

docker-build: ## Build application Docker image
	docker build \
		-f infra/docker/Dockerfile \
		-t $(IMAGE_NAME):$(IMAGE_TAG) \
		-t $(IMAGE_NAME):latest \
		--build-arg BUILD_DATE=$(shell date -u +%Y-%m-%dT%H:%M:%SZ) \
		--build-arg GIT_SHA=$(IMAGE_TAG) \
		.
	@echo "$(GREEN)✅ Image built: $(IMAGE_NAME):$(IMAGE_TAG)$(NC)"

docker-push: docker-build ## Build and push image
	docker push $(IMAGE_NAME):$(IMAGE_TAG)
	docker push $(IMAGE_NAME):latest

# ── Supply Chain ──────────────────────────────────────────────
sbom: ## Generate SBOM (requires syft)
	@command -v syft >/dev/null || (echo "$(RED)syft not found. Install: https://github.com/anchore/syft$(NC)" && exit 1)
	syft packages . -o spdx-json=sbom.spdx.json
	syft packages . -o cyclonedx-json=sbom.cyclonedx.json
	@echo "$(GREEN)✅ SBOM generated$(NC)"

sign: ## Sign container image with cosign
	@command -v cosign >/dev/null || (echo "$(RED)cosign not found$(NC)" && exit 1)
	cosign sign --key $$COSIGN_KEY_PATH $(IMAGE_NAME):$(IMAGE_TAG)
	@echo "$(GREEN)✅ Image signed$(NC)"

verify: ## Verify container image signature
	cosign verify --key $$COSIGN_CERT_PATH $(IMAGE_NAME):$(IMAGE_TAG)

sbom-attest: ## Attach SBOM attestation
	cosign attest --key $$COSIGN_KEY_PATH \
		--type spdxjson \
		--predicate sbom.spdx.json \
		$(IMAGE_NAME):$(IMAGE_TAG)

# ── OpenAPI ───────────────────────────────────────────────────
openapi: ## Export OpenAPI spec
	node scripts/export-openapi.js
	@echo "$(GREEN)✅ OpenAPI exported to docs/openapi.yaml$(NC)"

# ── Secrets / Vault ───────────────────────────────────────────
vault-init: ## Initialize local Vault dev server
	vault server -dev -dev-root-token-id=changeme &
	sleep 2
	VAULT_ADDR=http://localhost:8200 VAULT_TOKEN=changeme \
		vault secrets enable -path=secret kv-v2
	@echo "$(GREEN)✅ Vault initialized$(NC)"

vault-rotate: ## Trigger secret rotation (stub)
	node scripts/vault-rotate.js

# ── Redis ─────────────────────────────────────────────────────
redis-flush: ## Flush Redis (dev only — DANGEROUS)
	@echo "$(RED)⚠️  Flushing Redis...$(NC)"
	redis-cli FLUSHDB
	@echo "$(GREEN)✅ Redis flushed$(NC)"

redis-monitor: ## Monitor Redis commands live
	redis-cli monitor

# ── Health ────────────────────────────────────────────────────
health: ## Check service health
	@curl -sf http://localhost:$(PORT)/health | jq . || echo "$(RED)Health check failed$(NC)"

ready: ## Check service readiness
	@curl -sf http://localhost:$(PORT)/ready | jq . || echo "$(RED)Readiness check failed$(NC)"

# ── Terraform ─────────────────────────────────────────────────
tf-init: ## Initialize Terraform
	cd infra/terraform && terraform init

tf-plan: ## Plan Terraform changes
	cd infra/terraform && terraform plan -out=tfplan

tf-apply: ## Apply Terraform plan
	cd infra/terraform && terraform apply tfplan

tf-destroy: ## Destroy Terraform resources (DANGEROUS)
	@echo "$(RED)⚠️  Destroying infrastructure...$(NC)"
	cd infra/terraform && terraform destroy
