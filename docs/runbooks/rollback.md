# Runbook: Rollback Procedure

**Severity:** P1 / P2  
**Time to execute:** 5–30 minutes depending on scope

---

## When to use this runbook

- A deployment has caused elevated error rates (>1% 5xx)
- A migration has corrupted data or caused query failures
- A config change has caused auth or queue failures
- On-call engineer has triggered a rollback decision

---

## Decision criteria

```
Error rate > 1% for 5 min  →  investigate
Error rate > 5% for 2 min  →  rollback immediately
P99 latency > 5s           →  investigate, likely rollback
Auth failures spike        →  rollback immediately
Data corruption suspected  →  rollback + freeze writes
```

---

## Step 1: Declare Incident

```bash
# Post in #incidents channel
# Assign incident commander (IC)
# Open incident ticket
```

---

## Step 2: Roll back ECS service

```bash
# List recent task definition revisions
aws ecs list-task-definitions \
  --family-prefix platform-core \
  --sort DESC \
  --query 'taskDefinitionArns[:5]'

# Roll back to previous revision (e.g. :42)
aws ecs update-service \
  --cluster platform-prod \
  --service platform-core \
  --task-definition platform-core:42 \
  --force-new-deployment

# Monitor rollout
aws ecs wait services-stable \
  --cluster platform-prod \
  --services platform-core
```

---

## Step 3: Roll back database migration (if needed)

```bash
# CAUTION: Flyway undo requires undo scripts (V2__undo.sql pattern)
# Only run if the migration caused data issues

# Check current migration state
make migrate-info

# Undo last migration
make migrate-down

# Verify schema
psql $DATABASE_URL -c "\d items"
```

**Important:** If data has been written since the migration, undo may lose data.  
Consult DBA before running migrate-down in production.

---

## Step 4: Verify rollback

```bash
# Check health
make health
make ready

# Check error rate in Jaeger / OTel dashboard
# Check Postgres connections
# Check Redis connection
# Check SQS queue depth (should not be growing)
make health
curl https://api.example.com/health
```

---

## Step 5: Post-mortem

Within 48 hours of incident resolution:

1. Timeline of events
2. Root cause analysis (5 Whys)
3. What went wrong in detection / response
4. Action items to prevent recurrence
5. Update this runbook if gaps found

---

## Contacts

| Role              | Contact              |
|-------------------|----------------------|
| On-call Engineer  | PagerDuty rotation   |
| Platform Lead     | @platform-lead       |
| DBA               | @dba-team            |
| Security          | @security-team       |
