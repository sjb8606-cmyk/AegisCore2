-- migrations/seeds/dev-seed.sql
-- Development seed data — NOT for production.

INSERT INTO tenants (id, slug, name, plan, status) VALUES
  ('00000000-0000-0000-0000-000000000001', 'acme-corp',    'Acme Corp',    'pro',  'active'),
  ('00000000-0000-0000-0000-000000000002', 'beta-startup', 'Beta Startup', 'free', 'active'),
  ('00000000-0000-0000-0000-000000000003', 'deleted-co',   'Deleted Co',   'free', 'deleted')
ON CONFLICT (id) DO NOTHING;

-- Set tenant context and insert items for tenant 1
SELECT set_config('app.current_tenant_id', '00000000-0000-0000-0000-000000000001', false);
INSERT INTO items (tenant_id, name, description) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Alpha Item', 'First item for Acme'),
  ('00000000-0000-0000-0000-000000000001', 'Beta Item',  'Second item for Acme')
ON CONFLICT DO NOTHING;

-- Items for tenant 2
SELECT set_config('app.current_tenant_id', '00000000-0000-0000-0000-000000000002', false);
INSERT INTO items (tenant_id, name, description) VALUES
  ('00000000-0000-0000-0000-000000000002', 'Startup Widget', 'Beta startup item')
ON CONFLICT DO NOTHING;
