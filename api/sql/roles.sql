-- Run ONCE per Neon branch, in Neon's SQL Editor, AFTER the migrations have run
-- (`npm run db:migrate -w @zindex/api`). It is not a migration because it holds a password.
--
-- 1. Make a long random password (for example `openssl rand -hex 24`).
-- 2. Replace __APP_PASSWORD__ below. Never commit the edited file.
-- 3. Run it, then put the new user's connection string in .env.local and in Render as DATABASE_URL_APP.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'zx_app') then
    create role zx_app login password '__APP_PASSWORD__' in role zx_app_role;
  end if;
end
$$;
