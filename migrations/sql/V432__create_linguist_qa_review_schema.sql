CREATE TABLE IF NOT EXISTS linguist_qa_reviews (
  review_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  project_id UUID NOT NULL,
  reviewer_id UUID NOT NULL,
  accuracy_score NUMERIC(5,2),
  issues_found JSONB NOT NULL DEFAULT '[]'::jsonb,
  approved BOOLEAN NOT NULL DEFAULT FALSE,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT linguist_qa_reviews_accuracy_check
    CHECK (accuracy_score IS NULL OR (accuracy_score >= 0 AND accuracy_score <= 100))
);

ALTER TABLE linguist_qa_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE linguist_qa_reviews FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_linguist_qa_reviews
  ON linguist_qa_reviews
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_linguist_qa_reviews_tenant
  ON linguist_qa_reviews (tenant_id);

CREATE INDEX IF NOT EXISTS idx_linguist_qa_reviews_project
  ON linguist_qa_reviews (tenant_id, project_id);

CREATE INDEX IF NOT EXISTS idx_linguist_qa_reviews_reviewer
  ON linguist_qa_reviews (tenant_id, reviewer_id);
