-- Harden Form Submissions: Block cross-tenant WRITES
DROP POLICY IF EXISTS form_tenant_isolation ON form_submissions;
CREATE POLICY form_tenant_isolation ON form_submissions
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Harden Items: Block cross-tenant WRITES
DROP POLICY IF EXISTS items_tenant_isolation ON items;
CREATE POLICY items_tenant_isolation ON items
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
