-- =============================================================================
-- Veridact v1.0 — Migration V2: RLS Validation Helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION app.verify_tenant_isolation(
  p_receipt_id  UUID,
  p_owner_tid   UUID,
  p_other_tid   UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  visible_to_owner  INTEGER;
  visible_to_other  INTEGER;
BEGIN
  PERFORM set_config('app.current_tenant_id', p_owner_tid::text, true);
  SELECT COUNT(*) INTO visible_to_owner FROM receipts WHERE receipt_id = p_receipt_id;

  PERFORM set_config('app.current_tenant_id', p_other_tid::text, true);
  SELECT COUNT(*) INTO visible_to_other FROM receipts WHERE receipt_id = p_receipt_id;

  PERFORM set_config('app.current_tenant_id', '', true);

  RETURN (visible_to_owner = 1 AND visible_to_other = 0);
END;
$$;

CREATE OR REPLACE FUNCTION app.assert_no_physical_deletes()
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
  SELECT COUNT(*)::INTEGER
  FROM pg_rules
  WHERE tablename IN ('receipts', 'changes', 'alerts', 'coverage_boundaries', 'hitl_approvals', 'policy_bundles')
    AND rulename LIKE '%no_physical_delete%';
$$;

COMMENT ON FUNCTION app.verify_tenant_isolation IS
  'Integration test helper — asserts cross-tenant row invisibility under RLS';

COMMENT ON FUNCTION app.assert_no_physical_deletes IS
  'Smoke test — returns the count of no-delete rules installed across all tables';

GRANT EXECUTE ON FUNCTION app.assert_no_physical_deletes() TO veridact_app;
