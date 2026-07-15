#!/bin/bash
# infra/docker/localstack-init.sh
# Initialize AWS services in LocalStack for local development.

set -euo pipefail

REGION="us-east-1"
ENDPOINT="http://localhost:4566"

echo "Initializing LocalStack resources..."

# ── SQS ──────────────────────────────────────────────────────

echo "Creating SQS queues..."

# Main event queue (FIFO)
aws --endpoint-url="$ENDPOINT" sqs create-queue \
  --queue-name platform-events.fifo \
  --attributes '{"FifoQueue":"true","ContentBasedDeduplication":"false","ReceiveMessageWaitTimeSeconds":"20","VisibilityTimeout":"30","RedrivePolicy":"{\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-1:000000000000:platform-events-dlq.fifo\",\"maxReceiveCount\":\"3\"}"}' \
  --region "$REGION" || true

# Dead-letter queue (FIFO)
aws --endpoint-url="$ENDPOINT" sqs create-queue \
  --queue-name platform-events-dlq.fifo \
  --attributes '{"FifoQueue":"true","ContentBasedDeduplication":"false"}' \
  --region "$REGION" || true

# ── S3 ────────────────────────────────────────────────────────

echo "Creating S3 buckets..."

# Audit WORM bucket (Object Lock enabled)
aws --endpoint-url="$ENDPOINT" s3api create-bucket \
  --bucket platform-audit-worm \
  --region "$REGION" \
  --object-lock-enabled-for-bucket || true

# Configure default retention (COMPLIANCE, 7 years)
aws --endpoint-url="$ENDPOINT" s3api put-object-lock-configuration \
  --bucket platform-audit-worm \
  --object-lock-configuration '{
    "ObjectLockEnabled": "Enabled",
    "Rule": {
      "DefaultRetention": {
        "Mode": "COMPLIANCE",
        "Years": 7
      }
    }
  }' || true

# Enable versioning on audit bucket
aws --endpoint-url="$ENDPOINT" s3api put-bucket-versioning \
  --bucket platform-audit-worm \
  --versioning-configuration Status=Enabled || true

# ── KMS ──────────────────────────────────────────────────────

echo "Creating KMS key..."

KMS_KEY_ID=$(aws --endpoint-url="$ENDPOINT" kms create-key \
  --description "platform-core envelope encryption" \
  --region "$REGION" \
  --query 'KeyMetadata.KeyId' \
  --output text 2>/dev/null || echo "")

if [ -n "$KMS_KEY_ID" ]; then
  aws --endpoint-url="$ENDPOINT" kms create-alias \
    --alias-name alias/platform-core \
    --target-key-id "$KMS_KEY_ID" \
    --region "$REGION" || true
  echo "KMS Key ID: $KMS_KEY_ID"
fi

echo "✅ LocalStack initialization complete"
