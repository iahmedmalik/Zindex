-- Who may do what. One group role, zx_app_role; Ahmed creates the login role from
-- sql/roles.sql and puts it in the group.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'zx_app_role') then
    create role zx_app_role nologin;
  end if;
end
$$;

revoke all on all tables in schema public from public;
revoke all on all functions in schema public from public;

-- Sign-in tables: Better Auth runs as zx_app_role and needs full access to its own tables.
grant select, insert, update, delete on "user", session, account, verification to zx_app_role;
alter table "user" enable row level security;
alter table session enable row level security;
alter table account enable row level security;
alter table verification enable row level security;
create policy auth_backend on "user" for all to zx_app_role using (true) with check (true);
create policy auth_backend on session for all to zx_app_role using (true) with check (true);
create policy auth_backend on account for all to zx_app_role using (true) with check (true);
create policy auth_backend on verification for all to zx_app_role using (true) with check (true);

-- Stores: an owner manages their own rows. The invoice counter is never written directly;
-- only allocate_invoice_number() moves it (it is not in the column lists below).
grant select, delete on stores to zx_app_role;
grant insert (owner_id, name, phone, address, logo_url, accent, invoice_prefix) on stores to zx_app_role;
grant update (name, phone, address, logo_url, accent, invoice_prefix, updated_at) on stores to zx_app_role;
alter table stores enable row level security;

-- Every request first runs: select set_config('app.owner_id', '<user id>', true) inside its
-- transaction. With no setting, current_setting returns null and nothing matches.
create policy stores_owner on stores
  for all to zx_app_role
  using (owner_id = current_setting('app.owner_id', true))
  with check (owner_id = current_setting('app.owner_id', true));

grant execute on function allocate_invoice_number(uuid) to zx_app_role;

-- Only the table owner applies migrations.
alter table _migrations enable row level security;
revoke all on _migrations from public, zx_app_role;
