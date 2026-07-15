# Runbook: Audit Recovery

**Trigger:** Chain verification failure OR gap in S3 audit objects  
**Owner:** Platform Security + Engineering  
**Classification:** CONFIDENTIAL

---

## Background

Audit events are stored in S3 with Object Lock (COMPLIANCE mode).
They cannot be deleted or overwritten. However, the following can break the chain:
- Shipper crash mid-batch
- Redis sequence counter reset
- Network partition during S3 write

---

## Step 1: Detect the gap

```bash
# Run chain verifier
node scripts/verify-audit-chain.js \
  --tenant-id <tenant-id> \
  --from 2024-01-01 \
  --to 2024-01-31

# Or list S3 objects and check sequence gaps
aws s3 ls s3://platform-audit-worm/audit/<tenant-id>/ \
  | awk '{print $4}' \
  | sort \
  | awk -F'-' 'NR>1 && $1 != prev+1 {print "GAP at seq:", $1} {prev=$1}'
```

---

## Step 2: Identify missing events

Missing events may be in:
1. **Local buffer** — in-memory queue in the audit emitter (lost on restart)
2. **SQS DLQ** — if S3 write failed after SQS receive
3. **Application logs** — structured log entries with `type=AUDIT_BUFFERED`

```bash
# Check application logs for buffered audit events
aws logs filter-log-events \
  --log-group-name /platform/api \
  --filter-pattern '{ $.module = "audit:emitter" }' \
  --start-time <epoch-ms>
```

---

## Step 3: Reconstruct missing events

If the event data can be reconstructed from application logs or DB:

```bash
# Use the recovery script to insert synthetic events with a flag
node scripts/audit-recover.js \
  --tenant-id <tenant-id> \
  --events recovered-events.json \
  --reason "Chain gap recovery — incident INC-2024-001"
```

Recovered events are tagged with `metadata.recovered: true` and `metadata.recoveryReason`.

---

## Step 4: Re-link chain from gap point

After inserting recovered events, re-link the Merkle chain:

```bash
node scripts/relink-audit-chain.js \
  --tenant-id <tenant-id> \
  --from-sequence <gap-start>
```

This re-computes `_prevHash` and `_hash` for all events from the gap onward.

**Note:** Because S3 objects are WORM, re-linked events are written as NEW objects
with a `_recovered: true` marker. The original (pre-gap) objects remain untouched.

---

## Step 5: Document and notify

- Record gap in incident ticket with:
  - Tenant ID
  - Sequence numbers affected
  - Events successfully recovered vs lost
  - Recovery method
- If events were permanently lost: notify tenant (GDPR/SOC2 obligation)
- File in compliance register

---

## Prevention

- Redis sequence counter backed up to Postgres `audit_chain_state` table hourly
- Shipper writes to Postgres before S3 (two-phase commit pattern)
- DLQ alert fires within 1 minute of first DLQ message
