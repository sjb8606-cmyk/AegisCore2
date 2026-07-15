CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    budget_cents BIGINT DEFAULT 0,
    start_date DATE,
    due_date DATE,
    status VARCHAR(50) DEFAULT 'active',
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    assigned_to VARCHAR(255),
    status VARCHAR(50) DEFAULT 'todo',
    start_date DATE,
    due_date DATE,
    estimated_hours NUMERIC(5,2) DEFAULT 0.00,
    parent_id UUID,
    depends_on UUID[] DEFAULT '{}',
    custom_fields JSONB DEFAULT '{}',
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_projects ON projects
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_tasks ON tasks
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_projects_tenant ON projects(tenant_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_project ON tasks(tenant_id, project_id) WHERE NOT is_deleted;
