-- ---------------------------------------------------------------------------
-- Product Price Tracker - reference schema (Supabase / PostgreSQL)
-- The assignment states these tables already exist; this file is a
-- reference/recovery script in case you need to (re)create them.
-- ---------------------------------------------------------------------------

create extension if not exists "pgcrypto";

create table if not exists products (
  id         uuid primary key default gen_random_uuid(),
  store_id   int  not null,
  name       text,
  sku        text
);

-- One tracked store product should appear only once.
create unique index if not exists products_store_id_key on products (store_id);

create table if not exists price_history (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid references products (id) on delete cascade,
  price       numeric,
  stock       int,
  scraped_at  timestamptz default now()
);

create index if not exists price_history_product_time_idx
  on price_history (product_id, scraped_at desc);

create table if not exists scrape_logs (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid references products (id) on delete cascade,
  status        text check (status in ('success', 'retried', 'failed')),
  attempts      int,
  error_message text,
  created_at    timestamptz default now()
);

create index if not exists scrape_logs_product_time_idx
  on scrape_logs (product_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS / access policies
-- The API uses the anon key, so the tables must be readable/writable by it.
-- For a demo/assignment this is fine; for production use the service_role key
-- on the server and lock these policies down.
-- ---------------------------------------------------------------------------
alter table products      enable row level security;
alter table price_history enable row level security;
alter table scrape_logs   enable row level security;

drop policy if exists products_demo_all on products;
create policy products_demo_all on products
  for all to anon using (true) with check (true);

drop policy if exists price_history_demo_all on price_history;
create policy price_history_demo_all on price_history
  for all to anon using (true) with check (true);

drop policy if exists scrape_logs_demo_all on scrape_logs;
create policy scrape_logs_demo_all on scrape_logs
  for all to anon using (true) with check (true);
