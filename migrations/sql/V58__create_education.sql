-- Idempotency guards
DROP TABLE IF EXISTS quiz_attempts CASCADE;
DROP TABLE IF EXISTS enrollments CASCADE;
DROP TABLE IF EXISTS lessons CASCADE;
DROP TABLE IF EXISTS courses CASCADE;

CREATE TABLE courses (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  created_by        UUID NOT NULL,
  title             VARCHAR(255) NOT NULL,
  description       TEXT,
  slug              VARCHAR(100) NOT NULL,
  status            VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  category          VARCHAR(100),
  level             VARCHAR(20) DEFAULT 'beginner' CHECK (level IN ('beginner','intermediate','advanced')),
  duration_hours    NUMERIC,
  price_cents       BIGINT DEFAULT 0,
  currency          VARCHAR(3) DEFAULT 'USD',
  is_free           BOOLEAN DEFAULT true,
  thumbnail_url     TEXT,
  student_count     INTEGER DEFAULT 0,
  completion_rate   NUMERIC DEFAULT 0,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at        TIMESTAMP WITH TIME ZONE,
  UNIQUE(tenant_id, slug)
);

CREATE TABLE lessons (
  id                  UUID PRIMARY KEY,
  tenant_id           UUID NOT NULL,
  course_id           UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title               VARCHAR(255) NOT NULL,
  type                VARCHAR(20) DEFAULT 'text' CHECK (type IN ('text','video','quiz','assignment','live')),
  content             TEXT,
  video_url           TEXT,
  duration_minutes    INTEGER,
  sort_order          INTEGER DEFAULT 0,
  is_free_preview     BOOLEAN DEFAULT false,
  drip_days           INTEGER DEFAULT 0,
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE enrollments (
  id                  UUID PRIMARY KEY,
  tenant_id           UUID NOT NULL,
  course_id           UUID NOT NULL REFERENCES courses(id),
  user_id             UUID NOT NULL,
  status              VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','completed','suspended','refunded')),
  progress_percent    NUMERIC DEFAULT 0,
  completed_lessons   UUID[] DEFAULT '{}',
  enrolled_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  completed_at        TIMESTAMP WITH TIME ZONE,
  certificate_url     TEXT,
  payment_id          UUID,
  UNIQUE(tenant_id, course_id, user_id)
);

CREATE TABLE quiz_attempts (
  id                UUID PRIMARY KEY,
  tenant_id         UUID NOT NULL,
  lesson_id         UUID NOT NULL REFERENCES lessons(id),
  user_id           UUID NOT NULL,
  answers           JSONB NOT NULL DEFAULT '{}',
  score_percent     NUMERIC,
  passed            BOOLEAN,
  attempt_number    INTEGER DEFAULT 1,
  completed_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_courses ON courses USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_lessons ON lessons USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_enrollments ON enrollments USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_quiz ON quiz_attempts USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_courses_tenant_status ON courses(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_courses_slug ON courses(tenant_id, slug);
CREATE INDEX IF NOT EXISTS idx_lessons_course ON lessons(course_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_enrollments_user ON enrollments(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_course ON enrollments(course_id);
