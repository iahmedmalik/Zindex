-- Editable WhatsApp message templates, one set per store. A store that has not edited a template
-- uses the built-in English default (kept in the API, src/whatsapp/templates.ts).

create table message_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default current_setting('app.owner_id', true) references "user" (id) on delete cascade,
  store_id uuid not null references stores (id) on delete cascade,
  key text not null check (key in ('order_confirmed', 'invoice', 'rider_assigned', 'on_the_way', 'delivered', 'payment_reminder', 'thank_you')),
  body text not null check (char_length(body) between 1 and 1000),
  updated_at timestamptz not null default now(),
  unique (store_id, key)
);
create index message_templates_owner_id on message_templates (owner_id);

grant select, delete on message_templates to zx_app_role;
grant insert (store_id, key, body) on message_templates to zx_app_role;
grant update (body, updated_at) on message_templates to zx_app_role;
alter table message_templates enable row level security;
create policy message_templates_owner on message_templates
  for all to zx_app_role
  using (owner_id = current_setting('app.owner_id', true))
  with check (
    owner_id = current_setting('app.owner_id', true)
    and exists (select 1 from stores s where s.id = message_templates.store_id)
  );
