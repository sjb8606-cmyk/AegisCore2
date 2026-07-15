-- Drop and recreate views with the SECURITY_BARRIER flag
DROP VIEW IF EXISTS active_items;
CREATE VIEW active_items WITH (security_barrier) AS
    SELECT * FROM items WHERE deleted_at IS NULL;
