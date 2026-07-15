-- Idempotency guards to clear any half-applied schema state
DROP TABLE IF EXISTS search_embeddings CASCADE;
DROP FUNCTION IF EXISTS cosine_similarity(DOUBLE PRECISION[], DOUBLE PRECISION[]);

-- Create native mathematical Cosine Similarity resolver
CREATE OR REPLACE FUNCTION cosine_similarity(a DOUBLE PRECISION[], b DOUBLE PRECISION[]) 
RETURNS DOUBLE PRECISION AS $$
DECLARE
  dot_product DOUBLE PRECISION := 0.0;
  norm_a DOUBLE PRECISION := 0.0;
  norm_b DOUBLE PRECISION := 0.0;
  i INTEGER;
BEGIN
  FOR i IN 1..array_length(a, 1) LOOP
    dot_product := dot_product + (a[i] * b[i]);
    norm_a := norm_a + (a[i] * a[i]);
    norm_b := norm_b + (b[i] * b[i]);
  END LOOP;
  IF norm_a = 0 OR norm_b = 0 THEN
    RETURN 0.0;
  END IF;
  RETURN dot_product / (|/norm_a * |/norm_b);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE TABLE search_embeddings (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  entity_type     VARCHAR(100) NOT NULL,
  entity_id       UUID NOT NULL,
  content         TEXT NOT NULL,
  embedding       DOUBLE PRECISION[] NOT NULL,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE search_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_embeddings ON search_embeddings USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_search_embeddings_tenant ON search_embeddings(tenant_id, entity_type);
