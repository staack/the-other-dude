-- Create the application role that enforces RLS (cannot bypass RLS)
-- This role is used by the FastAPI application for all DB operations
CREATE ROLE app_user WITH LOGIN PASSWORD 'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;

-- Grant connect to the database
GRANT CONNECT ON DATABASE mikrotik TO app_user;

-- Grant schema usage
GRANT USAGE ON SCHEMA public TO app_user;

-- Future tables will have explicit grants via migrations
-- The app_user role cannot bypass RLS (only superusers can)

-- Create the poller role used exclusively by the Go poller microservice.
-- This role has SELECT-only access to the devices table and does NOT enforce
-- RLS — the poller must read all devices across all tenants to poll them.
-- Password can be overridden in production via Helm/Kubernetes secrets.
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'poller_user') THEN
        CREATE ROLE poller_user WITH LOGIN PASSWORD 'poller_password' NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
    END IF;
END
$$;

GRANT CONNECT ON DATABASE mikrotik TO poller_user;
GRANT USAGE ON SCHEMA public TO poller_user;
-- SELECT grant on devices is applied via Alembic migration 002
-- (after the devices table is created)
