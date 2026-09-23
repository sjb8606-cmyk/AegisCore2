-- Option B foundation: pages + blocks (tree)
-- Adjust version number if it collides with an existing migration.

CREATE TABLE IF NOT EXISTS workspace_pages (
  id          UUID PRIMARY KEY,
  tenant_id   UUID NOT NULL,
  title       TEXT NOT NULL,
  parent_page_id UUID NULL REFERENCES workspace_pages(id) ON DELETE SET NULL,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_pages_tenant ON workspace_pages(tenant_id);

CREATE TABLE IF NOT EXISTS workspace_blocks (
  id          UUID PRIMARY KEY,
  tenant_id   UUID NOT NULL,
  page_id     UUID NOT NULL REFERENCES workspace_pages(id) ON DELETE CASCADE,
  parent_block_id UUID NULL REFERENCES workspace_blocks(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  props       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_blocks_page ON workspace_blocks(tenant_id, page_id);
CREATE INDEX IF NOT EXISTS idx_workspace_blocks_parent ON workspace_blocks(parent_block_id);
