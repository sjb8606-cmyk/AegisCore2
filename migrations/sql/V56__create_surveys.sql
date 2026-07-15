-- Drop existing tables to clear any half-applied schema state
DROP TABLE IF EXISTS survey_responses CASCADE;
DROP TABLE IF EXISTS surveys CASCADE;

-- Recreate Surveys Table
CREATE TABLE surveys (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    created_by UUID NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','active','closed','archived')),
    type VARCHAR(20) DEFAULT 'general' CHECK (type IN ('general','nps','csat','quiz','assessment')),
    questions JSONB NOT NULL DEFAULT '[]',
    settings JSONB DEFAULT '{}',
    theme JSONB DEFAULT '{}',
    response_count INTEGER DEFAULT 0,
    response_quota INTEGER,
    starts_at TIMESTAMP WITH TIME ZONE,
    ends_at TIMESTAMP WITH TIME ZONE,
    is_anonymous BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Recreate Survey Responses Table
CREATE TABLE survey_responses (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    survey_id UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    respondent_id UUID,
    respondent_email VARCHAR(255),
    answers JSONB NOT NULL DEFAULT '{}',
    nps_score INTEGER,
    completed BOOLEAN DEFAULT TRUE,
    time_taken_seconds INTEGER,
    ip_address INET,
    user_agent TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Enable Row-Level Security
ALTER TABLE surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;

-- Apply Tenant Isolation Policies (v3.6.3 standard)
CREATE POLICY tenant_isolation_surveys ON surveys
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_responses ON survey_responses
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Core performance indexes
CREATE INDEX IF NOT EXISTS idx_surveys_tenant ON surveys(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_responses_survey ON survey_responses(survey_id);
CREATE INDEX IF NOT EXISTS idx_responses_tenant ON survey_responses(tenant_id);
