DROP TABLE IF EXISTS comments CASCADE;

CREATE TABLE comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    resource_type VARCHAR(100) NOT NULL,
    resource_id VARCHAR(255) NOT NULL,
    body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_comments_resource ON comments(tenant_id, resource_type, resource_id, created_at);
CREATE INDEX idx_comments_user ON comments(tenant_id, user_id);

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_comments ON comments USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
