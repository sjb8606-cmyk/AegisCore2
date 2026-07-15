-- 1. Enable RLS on the Tenants table correctly
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

-- 2. Policy: Tenants can only read/write their OWN record
CREATE POLICY tenants_self_isolation ON tenants
    USING (id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (id = current_setting('app.current_tenant_id', true)::uuid);

-- 3. Admin Bypass (Logged)
CREATE POLICY tenants_admin_bypass ON tenants
    TO platform_admin USING (true);
