DROP TABLE IF EXISTS feedback_clusters CASCADE;
DROP TABLE IF EXISTS sentiment_trends CASCADE;
DROP TABLE IF EXISTS customer_health_scores CASCADE;
DROP TABLE IF EXISTS sentiment_analysis CASCADE;

CREATE TABLE sentiment_analysis (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  entity_type       VARCHAR(50) NOT NULL,
  entity_id         UUID NOT NULL,
  text              TEXT NOT NULL,
  sentiment_score   NUMERIC(5,2) NOT NULL,
  emotion           VARCHAR(50) NOT NULL,
  confidence        NUMERIC(5,2) NOT NULL,
  source_channel    VARCHAR(50) NOT NULL,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE customer_health_scores (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  customer_id       UUID NOT NULL,
  health_score      NUMERIC(5,2) NOT NULL,
  churn_risk        NUMERIC(5,2) NOT NULL,
  nps_prediction    NUMERIC(5,2) NOT NULL,
  last_updated      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, customer_id)
);

CREATE TABLE sentiment_trends (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  metric_name       VARCHAR(100) NOT NULL,
  value             NUMERIC(5,2) NOT NULL,
  time_bucket       TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE feedback_clusters (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  cluster_name      VARCHAR(255) NOT NULL,
  keywords          JSONB NOT NULL,
  volume            INTEGER NOT NULL,
  sentiment_avg     NUMERIC(5,2) NOT NULL,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE sentiment_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_health_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE sentiment_trends ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_clusters ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_analysis ON sentiment_analysis USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_health ON customer_health_scores USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_trends ON sentiment_trends USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_clusters ON feedback_clusters USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_sentiment_tenant ON sentiment_analysis(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_customer ON customer_health_scores(customer_id);
CREATE INDEX IF NOT EXISTS idx_trends_metric ON sentiment_trends(tenant_id, metric_name, time_bucket);
