-- Shared rate-limit counters. On Vercel the API runs as many short-lived copies, so a counter kept in one
-- copy's memory would let a guesser spread tries across copies. Every copy reads and writes this table instead.
-- Used by Better Auth (sign-in, sign-up, password reset), "Try the demo" and the public delivery card.
create table rate_limit (
  id text primary key,
  key text not null unique,
  count integer not null,
  last_request bigint not null
);
create index rate_limit_last_request on rate_limit (last_request);

grant select, insert, update, delete on rate_limit to zx_app_role;
alter table rate_limit enable row level security;
create policy auth_backend on rate_limit for all to zx_app_role using (true) with check (true);
