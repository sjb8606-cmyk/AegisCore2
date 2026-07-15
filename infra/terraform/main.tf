# infra/terraform/main.tf
# Core AWS infrastructure for platform-core.
# Run: make tf-init && make tf-plan && make tf-apply

terraform {
  required_version = ">= 1.7"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
  }
  # Remote state (update bucket/key for your environment)
  backend "s3" {
    bucket         = "platform-terraform-state"
    key            = "platform-core/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "platform-terraform-locks"
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project     = "platform-core"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# ── Variables ─────────────────────────────────────────────────
variable "aws_region"   { default = "us-east-1" }
variable "environment"  { default = "production" }
variable "service_name" { default = "platform-core" }

# ── KMS Key ───────────────────────────────────────────────────
resource "aws_kms_key" "platform" {
  description              = "platform-core envelope encryption key"
  deletion_window_in_days  = 30
  enable_key_rotation      = true  # Annual auto-rotation
  multi_region             = false

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "Enable IAM User Permissions"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid    = "Allow ECS task role"
        Effect = "Allow"
        Principal = { AWS = aws_iam_role.ecs_task.arn }
        Action = ["kms:GenerateDataKey", "kms:Decrypt"]
        Resource = "*"
      }
    ]
  })
}

resource "aws_kms_alias" "platform" {
  name          = "alias/platform-core"
  target_key_id = aws_kms_key.platform.key_id
}

# ── S3 Audit WORM Bucket ──────────────────────────────────────
resource "aws_s3_bucket" "audit" {
  bucket        = "platform-audit-worm-${var.environment}-${data.aws_caller_identity.current.account_id}"
  force_destroy = false  # Prevent accidental destruction
}

resource "aws_s3_bucket_object_lock_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id
  rule {
    default_retention {
      mode  = "COMPLIANCE"
      years = 7
    }
  }
}

resource "aws_s3_bucket_versioning" "audit" {
  bucket = aws_s3_bucket.audit.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.platform.arn
    }
  }
}

resource "aws_s3_bucket_public_access_block" "audit" {
  bucket                  = aws_s3_bucket.audit.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ── SQS Queues ────────────────────────────────────────────────
resource "aws_sqs_queue" "dlq" {
  name                        = "platform-events-dlq.fifo"
  fifo_queue                  = true
  content_based_deduplication = false
  message_retention_seconds   = 1209600  # 14 days
  kms_master_key_id           = aws_kms_key.platform.arn
}

resource "aws_sqs_queue" "main" {
  name                        = "platform-events.fifo"
  fifo_queue                  = true
  content_based_deduplication = false
  visibility_timeout_seconds  = 30
  message_retention_seconds   = 86400   # 1 day
  receive_wait_time_seconds   = 20       # Long polling
  kms_master_key_id           = aws_kms_key.platform.arn

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = 3
  })
}

# ── IAM Role for ECS task ─────────────────────────────────────
resource "aws_iam_role" "ecs_task" {
  name = "${var.service_name}-ecs-task"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "ecs_task" {
  name = "platform-core-task-policy"
  role = aws_iam_role.ecs_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage", "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = [aws_sqs_queue.main.arn, aws_sqs_queue.dlq.arn]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.audit.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["kms:GenerateDataKey", "kms:Decrypt"]
        Resource = aws_kms_key.platform.arn
      }
    ]
  })
}

# ── Data sources ──────────────────────────────────────────────
data "aws_caller_identity" "current" {}

# ── Outputs ───────────────────────────────────────────────────
output "kms_key_id"       { value = aws_kms_key.platform.key_id }
output "kms_key_arn"      { value = aws_kms_key.platform.arn }
output "audit_bucket"     { value = aws_s3_bucket.audit.id }
output "sqs_queue_url"    { value = aws_sqs_queue.main.url }
output "sqs_dlq_url"      { value = aws_sqs_queue.dlq.url }
output "ecs_task_role_arn"{ value = aws_iam_role.ecs_task.arn }
