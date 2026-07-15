# Runbook: DLQ Triage

**Trigger:** CloudWatch alarm — DLQ depth > 0  
**Owner:** Platform Engineering

---

## Background

The Dead-Letter Queue (DLQ) receives messages that failed processing after
`maxReceiveCount` (default: 3) attempts. Every DLQ message represents a
permanently failed operation that requires manual investigation.

---

## Step 1: Assess scope

```bash
# Check DLQ depth
aws sqs get-queue-attributes \
  --queue-url $SQS_DLQ_URL \
  --attribute-names ApproximateNumberOfMessages \
  --query 'Attributes.ApproximateNumberOfMessages'

# Check main queue depth (backpressure?)
aws sqs get-queue-attributes \
  --queue-url $SQS_QUEUE_URL \
  --attribute-names ApproximateNumberOfMessages
```

---

## Step 2: Inspect DLQ messages

```bash
# Peek at messages (does NOT delete them)
aws sqs receive-message \
  --queue-url $SQS_DLQ_URL \
  --max-number-of-messages 10 \
  --attribute-names All \
  --message-attribute-names All \
  | jq '.Messages[] | { id: .MessageId, body: (.Body | fromjson), receiveCount: .Attributes.ApproximateReceiveCount }'
```

---

## Step 3: Identify failure cause

Common causes:

| Symptom                         | Likely Cause                    | Action                      |
|---------------------------------|---------------------------------|-----------------------------|
| Schema parse error              | Message format changed          | Fix producer, replay         |
| DB connection error             | Postgres down                   | Restore DB, replay           |
| S3 PutObject 403                | IAM policy issue                | Fix IAM, replay              |
| Tenant not found                | Race condition on tenant delete | Investigate, discard or fix  |
| Audit Merkle hash mismatch      | Chain corruption                | See audit-recovery runbook   |
| OOM / timeout                   | Message too large               | Split + replay               |

Check logs:
```bash
# Filter DLQ_ARCHIVE structured log entries
aws logs filter-log-events \
  --log-group-name /platform/workers \
  --filter-pattern '{ $.type = "DLQ_ARCHIVE" }' \
  --start-time $(date -d '1 hour ago' +%s000)
```

---

## Step 4: Replay messages

If the root cause is fixed, replay by moving messages back to main queue:

```bash
# Replay script (reads DLQ, re-enqueues to main, deletes from DLQ)
node scripts/dlq-replay.js \
  --dlq-url $SQS_DLQ_URL \
  --target-url $SQS_QUEUE_URL \
  --max-messages 100 \
  --dry-run  # remove --dry-run to actually replay
```

---

## Step 5: Discard if unrecoverable

```bash
# Purge DLQ only if messages are confirmed unrecoverable
# REQUIRES: approval from Platform Lead
aws sqs purge-queue --queue-url $SQS_DLQ_URL
```

---

## Step 6: Post-triage

- Document root cause in incident ticket
- If audit events were lost: run audit recovery runbook
- Adjust `maxReceiveCount` or `visibilityTimeout` if needed
- Add test case to prevent regression
