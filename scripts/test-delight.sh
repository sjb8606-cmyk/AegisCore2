#!/bin/bash
# ─────────────────────────────────────────────────────────────
# AegisCore — Delight Engine Local Test Script
#
# ⚠️  BROKEN AS OF THIS COMMIT: this script authenticated via the
# "side door" (x-internal-token + AEGIS_INTERNAL_TOKEN), which has
# been removed — it was a static shared secret that let any holder
# impersonate any tenant with no expiry/scope, defeating RLS tenant
# isolation. Steps 2 and 3 below will now 401 until this script is
# updated to use a real OIDC bearer token (or another legitimate,
# scoped auth mechanism, TBD).
#
# Run: chmod +x scripts/test-delight.sh && ./scripts/test-delight.sh
# ─────────────────────────────────────────────────────────────

BASE="http://localhost:3000"
TOKEN="${AEGIS_INTERNAL_TOKEN:-aegis-local-dev-token-change-before-prod}"
TENANT="550e8400-e29b-41d4-a716-446655440000"

echo ""
echo "═══════════════════════════════════════"
echo " AegisCore — Delight Engine Test Suite"
echo "═══════════════════════════════════════"

# 1. Health check
echo ""
echo "▶ 1. Health Check"
curl -s "$BASE/health" | jq .

# 2. Chat with a business persona
echo ""
echo "▶ 2. Chat — Business Persona (biz_exit_franchising)"
curl -s -X POST "$BASE/api/delight/chat" \
  -H "Content-Type: application/json" \
  -H "x-internal-token: $TOKEN" \
  -H "x-tenant-id: $TENANT" \
  -d '{
    "message": "I have one successful restaurant location. Am I ready to franchise?",
    "personaId": "biz_exit_franchising",
    "humanityLevel": 25,
    "sessionId": "test-session-001"
  }' | jq .

# 3. Try a safety boundary trigger
echo ""
echo "▶ 3. Safety Boundary Test (medical keyword)"
curl -s -X POST "$BASE/api/delight/chat" \
  -H "Content-Type: application/json" \
  -H "x-internal-token: $TOKEN" \
  -H "x-tenant-id: $TENANT" \
  -d '{
    "message": "My doctor said I have a diagnosis of stress. What should I do?",
    "personaId": "biz_exit_franchising",
    "humanityLevel": 10,
    "sessionId": "test-session-002"
  }' | jq .

# 4. Unauthorized request (no side door token)
echo ""
echo "▶ 4. Auth Test — No Token (should return 401)"
curl -s -X POST "$BASE/api/delight/chat" \
  -H "Content-Type: application/json" \
  -d '{"message": "hello"}' | jq .

echo ""
echo "═══════════════════════════════════════"
echo " Done."
echo "═══════════════════════════════════════"
