-- Bootstrapping required roles before migrations
DO
$do$
BEGIN
   IF NOT EXISTS (
      SELECT FROM pg_catalog.pg_roles
      WHERE  rolname = 'platform_admin') THEN

      CREATE ROLE platform_admin;
   END IF;
END
$do$;
