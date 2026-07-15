# ─────────────────────────────────────────────────────────────
# platform-core — Production Dockerfile
# Multi-stage build: builder → runner
# ─────────────────────────────────────────────────────────────

# ── Stage 1: Builder ──────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /build

# Install build tools
RUN apk add --no-cache python3 make g++

# Copy manifests first (layer cache optimization)
COPY package.json package-lock.json ./
COPY platform/*/package.json ./platform/
COPY apps/*/package.json ./apps/

# Re-create directory structure for npm workspaces
RUN for dir in platform/auth platform/tenancy platform/audit platform/queues \
    platform/observability platform/security platform/metering \
    platform/ai-safety platform/utils apps/example-api; do \
    mkdir -p $dir; \
    done

COPY . .

# Install all dependencies
RUN npm ci --include=dev

# Build all packages
RUN npm run build

# ── Stage 2: Dependency pruner ────────────────────────────────
FROM node:20-alpine AS pruner

WORKDIR /build
COPY --from=builder /build ./
RUN npm prune --production

# ── Stage 3: Runner ───────────────────────────────────────────
FROM node:20-alpine AS runner

# Non-root user for security
RUN addgroup -S platform && adduser -S platform -G platform

WORKDIR /app

# Copy production artifacts only
COPY --from=pruner --chown=platform:platform /build/node_modules ./node_modules
COPY --from=pruner --chown=platform:platform /build/dist ./dist
COPY --from=pruner --chown=platform:platform /build/package.json ./

# Labels for provenance
ARG BUILD_DATE
ARG GIT_SHA
LABEL org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.title="platform-core" \
      org.opencontainers.image.description="Secure SaaS platform foundation"

# Drop all capabilities; add back only what's needed
USER platform

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Use dumb-init for proper signal handling
RUN apk add --no-cache dumb-init
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/apps/example-api/src/index.js"]
