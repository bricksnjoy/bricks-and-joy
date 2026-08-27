-- ============================================================================
-- BRICK'S & JOY — DATABASE SCHEMA (self-hosted PostgreSQL)
--
-- This replaces supabase_schema.sql. Two things are deliberately different:
--
--   1. `auth.users` is gone. Supabase kept accounts in a schema we did not own;
--      here they live in `app_users`, an ordinary table this file creates, and
--      every `created_by` / profile reference points at it instead.
--
--   2. Row Level Security is gone. RLS only works when the browser talks to the
--      database directly, which is exactly what we stopped doing — the browser
--      now talks to our API, and the API holds the one database password. Who
--      may read or write what is decided in server/policies.js, which mirrors
--      the old policies and tightens the two that were too loose (see the notes
--      in that file).
--
-- Everything is idempotent: running this file again on a live database is safe
-- and is how upgrades are applied.
--
--   psql "$DATABASE_URL" -f db/schema.sql
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid() on PG 12
create extension if not exists citext;     -- case-insensitive email

-- ── ACCOUNTS ────────────────────────────────────────────────────────────────
-- Staff sign into the back office; customers sign into the shop. Same table,
-- separated by `role`, because a person is a person — but the API never lets a
-- customer touch a back-office table.
create table if not exists app_users (
  id            uuid primary key default gen_random_uuid(),
  email         citext unique not null,
  password_hash text,                      -- null for Google-only accounts
  role          text not null default 'customer',   -- staff | customer
  full_name     text,
  provider      text default 'password',   -- password | google
  metadata      jsonb default '{}'::jsonb, -- mirrors Supabase's user_metadata
  confirmed_at  timestamptz,
  last_sign_in  timestamptz,
  created_at    timestamptz default now()
);
create index if not exists app_users_role_idx on app_users(role);

-- One-time tokens for "forgot password" emails.
create table if not exists password_resets (
  token      text primary key,
  user_id    uuid references app_users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz default now()
);
create index if not exists password_resets_user_idx on password_resets(user_id);

-- Refresh tokens, so a signed-in session survives a browser restart without
-- keeping a long-lived access token lying around in storage.
create table if not exists auth_sessions (
  token      text primary key,
  user_id    uuid references app_users(id) on delete cascade,
  expires_at timestamptz not null,
  user_agent text,
  created_at timestamptz default now()
);
create index if not exists auth_sessions_user_idx on auth_sessions(user_id);

-- ── CUSTOMERS ───────────────────────────────────────────────────────────────
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  instagram text,
  phone text,
  address text,
  landmark text,
  notes text,
  created_at timestamptz default now(),
  created_by uuid references app_users(id) on delete set null
);

-- ── SUPPLIERS ───────────────────────────────────────────────────────────────
create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  email text,
  phone text,
  address text,
  notes text,
  payment_terms text,                -- "Net 30" etc. — shown as the Terms badge on Vendors
  currency text default 'MVR',       -- what this supplier invoices in
  is_overseas boolean default false,
  created_at timestamptz default now()
);

-- ── PRODUCTS (inventory) ────────────────────────────────────────────────────
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  age_range text,
  brand text,
  supplier_id uuid references suppliers(id) on delete set null,
  sku text,
  stock_qty integer default 0,
  low_stock_threshold integer default 10,
  cost_price numeric(10,2) default 0,
  sell_price numeric(10,2) default 0,
  description text,
  -- shop-facing fields
  safety_warnings text,
  battery text,
  materials text,
  video_url text,
  featured boolean default false,
  badge text,
  sale_price numeric(10,2),
  images jsonb,
  photo_url text,
  barcode text,
  pieces integer,
  sizes text,
  weight text,
  dimensions text,
  tags text,
  discontinued boolean default false,
  -- the same toy in several sizes: each size is its own product, these say
  -- which family it belongs to and which member it is
  variant_group text,
  variant_label text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists products_variant_group_idx on products(variant_group);

-- ── ORDERS (sales to customers) ─────────────────────────────────────────────
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete set null,
  customer_name text,
  product_id uuid references products(id) on delete set null,
  product_name text,
  qty integer not null default 1,
  unit_price numeric(10,2) not null default 0,
  total_price numeric(10,2) generated always as (qty * unit_price) stored,
  channel text default 'Retail store',
  status text default 'pending',
  order_date date default current_date,
  delivery_person text,
  delivery_date date,
  delivery_time text,
  fulfilment text default 'delivery',        -- delivery | pickup
  notes text,
  -- invoicing and payment
  invoice_number text,
  payment_status text default 'unpaid',
  payment_method text,
  paid_at timestamptz,
  transfer_reference text,
  transfer_slip_url text,
  transfer_payer text,
  transfer_amount numeric,
  transfer_date date,
  transfer_time text,
  -- charges carried on the invoice
  discount numeric default 0,
  delivery_fee numeric default 0,
  delivery_fee_covered boolean default false,
  special_request text,
  special_request_cost numeric default 0,
  special_request_covered boolean default false,
  -- money handed back
  refund_amount numeric,
  refunded_on date,
  refund_method text,
  refund_reference text,
  -- stock leaves inventory at dispatch, not at order creation
  stock_deducted boolean default false,
  created_at timestamptz default now(),
  created_by uuid references app_users(id) on delete set null,
  created_by_email text
);
create index if not exists orders_invoice_idx on orders(invoice_number);
create index if not exists orders_customer_idx on orders(customer_id);

-- ── PURCHASE ORDERS (buying from suppliers) ─────────────────────────────────
create table if not exists purchase_orders (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references suppliers(id) on delete set null,
  supplier_name text,
  product_id uuid references products(id) on delete set null,
  product_name text,
  qty integer not null default 1,
  unit_cost numeric(10,2) not null default 0,
  total_cost numeric(10,2) generated always as (qty * unit_cost) stored,
  status text default 'pending',
  order_date date default current_date,
  expected_date date,
  notes text,
  batch_id text,
  batch_no text,
  cost_type text,                    -- 'extra' = freight/duty/fees, not goods
  image_url text,
  slip_url text,                     -- the payment slip shown on a batch order
  stock_added boolean default false,
  created_at timestamptz default now(),
  created_by uuid references app_users(id) on delete set null
);
create index if not exists purchase_orders_batch_idx on purchase_orders(batch_id);

-- ── EXPENSES ────────────────────────────────────────────────────────────────
create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  category text not null,
  amount numeric(10,2) not null default 0,
  currency text default 'MVR',
  paid_from text default 'bank',     -- bank | cash
  expense_date date default current_date,
  slips jsonb default '[]'::jsonb,
  reference text,
  created_at timestamptz default now(),
  created_by uuid references app_users(id) on delete set null
);

-- ── EMAIL CONTACTS ──────────────────────────────────────────────────────────
create table if not exists email_contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  role text,
  phone text,
  created_at timestamptz default now()
);

-- ── SUPPLIER PRODUCT CATALOG ────────────────────────────────────────────────
create table if not exists supplier_products (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references suppliers(id) on delete cascade,
  supplier_name text,
  product_name text not null,
  sku text,
  category text,
  price numeric(10,2),
  unit text default 'piece',
  barcode text,
  notes text,
  custom_fields jsonb,
  is_favorite boolean default false,
  -- Three fields typed in against catalog lines over the years. Nothing in the
  -- app reads them today, but they are somebody's work and the move is not the
  -- place to quietly throw them away.
  product_id uuid,                   -- the inventory product this line became
  supplier_sku text,                 -- the supplier's own code for it
  moq numeric,                       -- minimum order quantity
  cost_price numeric,
  -- the supplier's price as it was actually quoted, in dollars. A later change
  -- to the dollar rate re-prices cost_price from this; rows entered directly in
  -- MVR leave it null and are never re-priced.
  cost_usd numeric,
  sell_price numeric,
  brand text,
  age_range text,
  pieces integer,
  sizes text,
  weight text,
  dimensions text,
  description text,
  tags text,
  image_url text,
  created_at timestamptz default now()
);

-- ── CATEGORIES ──────────────────────────────────────────────────────────────
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  color text default '#FFA500',
  created_at timestamptz default now()
);

-- ── SEASONAL CAMPAIGN PLANS (Planning tab) ──────────────────────────────────
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  occasion_date date not null,
  emoji text,
  lead_days int default 90,
  notify_email text,
  recurring boolean default true,
  plan jsonb,
  last_notified_year int,
  notified_30_year int,
  created_at timestamptz default now()
);

-- ── EVENTS & GIVEAWAYS ──────────────────────────────────────────────────────
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text default 'idea',            -- idea | planned | done
  platform text,
  event_date date,
  prep_date date,
  description text,
  impressions int default 0,
  reach int default 0,
  likes int default 0,
  comments int default 0,
  shares int default 0,
  saves int default 0,
  followers int default 0,
  results_notes text,
  cash_amount numeric(10,2) default 0,
  cash_items jsonb,
  cash_category text default 'Promotions',
  cash_expense_id uuid,
  product_cost numeric(10,2) default 0,
  images jsonb,
  created_at timestamptz default now(),
  created_by uuid references app_users(id) on delete set null
);

create table if not exists event_giveaways (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  product_name text,
  qty int not null default 1,
  unit_cost numeric(10,2) default 0,
  expense_id uuid,
  created_at timestamptz default now()
);

-- ── SUPPLIER PAYMENTS ───────────────────────────────────────────────────────
create table if not exists supplier_payments (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid references purchase_orders(id) on delete cascade,
  supplier_id uuid references suppliers(id) on delete set null,
  supplier_name text,
  amount numeric(10,2) not null,
  payment_date date default current_date,
  payment_method text default 'Bank Transfer',
  -- one payment can be several bank transfers: every reference joined with
  -- commas here (so search and reconciliation matching keep working), and each
  -- one separately in payment_references. ("references" is a reserved word.)
  reference text,
  payment_references jsonb default '[]'::jsonb,
  slips jsonb default '[]'::jsonb,
  notes text,
  batch_no text,
  created_at timestamptz default now()
);

-- ── STAFF PROFILES ──────────────────────────────────────────────────────────
create table if not exists profiles (
  id uuid primary key references app_users(id) on delete cascade,
  full_name text,
  role text default 'staff',
  created_at timestamptz default now()
);

-- Give every new account a profile row, the way the Supabase trigger did.
create or replace function handle_new_user() returns trigger
language plpgsql as $$
begin
  insert into profiles (id, full_name, role)
  values (new.id, coalesce(new.full_name, new.metadata->>'full_name'), new.role)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_app_user_created on app_users;
create trigger on_app_user_created
  after insert on app_users
  for each row execute procedure handle_new_user();

-- ── ORDER ANALYSIS ──────────────────────────────────────────────────────────
-- The planning phase between the supplier catalog and a batch order. Kept in
-- its own tables on purpose: nothing here reaches purchase_orders (and
-- therefore accounting) until an analysis is explicitly converted.
create table if not exists order_analyses (
  id uuid primary key default gen_random_uuid(),
  name text,
  supplier_id uuid,
  supplier_name text,
  status text default 'draft',                 -- draft | converted
  notes text,
  extra_costs jsonb default '[]'::jsonb,       -- [{ type, label, amount }]
  target_margin numeric default 40,
  -- each draft locks its own dollar rate, so a later change in Settings cannot
  -- silently re-price a batch that has already been costed
  usd_rate numeric default 15.42,
  batch_id text,
  batch_no text,
  converted_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists order_analysis_items (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid references order_analyses(id) on delete cascade,
  source text default 'catalog',               -- catalog | inventory | manual
  supplier_product_id uuid,
  product_id uuid,
  product_name text not null,
  sku text,
  category text,
  brand text,
  image_url text,
  qty integer default 1,
  unit_cost numeric default 0,
  sell_price numeric default 0,
  current_stock numeric,
  sizes text,
  notes text,
  sort_order integer default 0,
  created_at timestamptz default now()
);
create index if not exists order_analysis_items_analysis_idx on order_analysis_items(analysis_id);
create index if not exists order_analyses_status_idx on order_analyses(status);

-- ── LOANS ───────────────────────────────────────────────────────────────────
create table if not exists loans (
  id uuid primary key default gen_random_uuid(),
  lender text,                                 -- joined names, kept for reports
  lenders jsonb default '[]'::jsonb,           -- a loan can come from several people
  amount numeric(10,2) default 0,
  purpose text,
  monthly_payment numeric(10,2) default 0,
  taken_on date default current_date,
  received_date date,                          -- when the money actually landed
  tenure_months integer,
  grace_months integer default 0,
  profit_rate numeric default 0,
  rate_type text default 'flat',               -- flat | reducing | none
  total_payable numeric,
  reference text,
  status text default 'active',                -- active | closed
  payment_day integer default 28,
  monthly_auto boolean default true,
  slips jsonb default '[]'::jsonb,             -- agreement documents
  received_slips jsonb default '[]'::jsonb,    -- disbursement slip
  notes text,
  created_at timestamptz default now()
);

create table if not exists loan_payments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid references loans(id) on delete cascade,
  amount numeric(10,2) default 0,
  principal numeric,
  profit numeric,
  method text,
  account text,
  reference text,
  due_date date,                               -- which instalment it covers
  paid_on date default current_date,
  paid_time text,                              -- tells apart two same-day, same-amount payments
  slips jsonb default '[]'::jsonb,
  notes text,
  created_at timestamptz default now()
);
create index if not exists loan_payments_loan_idx on loan_payments(loan_id);

-- ── AUDIT LOG ───────────────────────────────────────────────────────────────
-- Append-only: the API refuses updates and deletes on this table.
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  user_email text,
  action text,          -- create | update | delete | cancel | return | payment | stock
  entity text,          -- order | product | purchase_order | customer | vendor | catalog
  entity_label text,
  details jsonb,
  at timestamptz default now()
);
create index if not exists audit_log_at_idx on audit_log(at desc);

-- ── RECONCILIATION ──────────────────────────────────────────────────────────
create table if not exists reconciliations (
  id uuid primary key default gen_random_uuid(),
  account text,
  period_start date,
  period_end date,
  statement_in numeric default 0,
  statement_out numeric default 0,
  opening_balance numeric,
  closing_balance numeric default 0,
  book_balance numeric,
  matched_count integer default 0,
  unmatched_count integer default 0,
  cleared jsonb default '[]'::jsonb,   -- ids of the book entries this cleared
  lines jsonb default '[]'::jsonb,     -- every statement line, so it can be reopened
  created_at timestamptz default now()
);

-- Book entries settled by hand as "won't appear on the bank statement".
create table if not exists settled_entries (
  book_id text primary key,            -- e.g. 'expense:123'
  reason text,
  created_at timestamptz default now()
);

-- Small key/value store for single settings that must sync across devices
-- (reconciliation start date, sidebar order).
create table if not exists app_settings (
  key text primary key,
  value jsonb,
  updated_at timestamptz default now()
);

-- ── CASH AND CLOSING THE BOOKS ──────────────────────────────────────────────
-- Cash never touches a bank statement, so without this the money in the drawer
-- is invisible and can go missing with nothing noticing.
create table if not exists cash_movements (
  id uuid primary key default gen_random_uuid(),
  kind text not null,              -- banked | count | adjustment
  amount numeric default 0,
  occurred_on date default current_date,
  expected numeric,                -- a count records what the books said at the time
  variance numeric,                -- counted minus expected, so a shortfall shows
  reference text,
  note text,
  created_at timestamptz default now()
);
create index if not exists cash_movements_date_idx on cash_movements(occurred_on desc);

-- Everything dated on or before locked_through is fixed. The newest row wins.
create table if not exists period_locks (
  id uuid primary key default gen_random_uuid(),
  locked_through date not null,
  note text,
  locked_by text,
  created_at timestamptz default now()
);

-- ── TASKS & CALENDAR ────────────────────────────────────────────────────────
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  task_date date,
  priority text default 'Medium',
  notes text,
  done boolean default false,
  created_at timestamptz default now(),
  completed_at timestamptz
);
create index if not exists tasks_date_idx on tasks(task_date);
create index if not exists tasks_done_idx on tasks(done);

-- ── MESSAGE LOG ─────────────────────────────────────────────────────────────
-- Every email and SMS as it is sent, succeeded or not, so the Message Center
-- can show what went out, what failed and why, and how many SMS parts were used
-- (which is what the gateway bills).
create table if not exists message_log (
  id uuid primary key default gen_random_uuid(),
  channel text not null,             -- email | sms
  recipient text,
  recipient_name text,
  subject text,
  preview text,
  chars int default 0,
  segments int default 0,
  unicode boolean default false,
  ok boolean default false,
  error text,
  route text,                        -- resend | emailjs | messageowl
  context text,
  sent_by text,
  created_at timestamptz default now()
);
create index if not exists message_log_created_idx on message_log (created_at desc);
create index if not exists message_log_channel_idx on message_log (channel, created_at desc);

-- ── ADS & CAMPAIGNS ─────────────────────────────────────────────────────────
-- The money itself stays in expenses — that is the record of what was paid. A
-- campaign here is the story around a slice of it.
create table if not exists ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  platform text default 'Instagram',
  objective text,
  status text default 'active',      -- planned | active | ended
  start_date date not null default current_date,
  end_date date,
  spend numeric(10,2) default 0,
  expense_id uuid,
  product_id uuid,
  product_name text,
  audience text,
  notes text,
  impressions integer default 0,
  reach integer default 0,
  likes integer default 0,
  comments integer default 0,
  shares integer default 0,
  saves integer default 0,
  clicks integer default 0,
  profile_visits integer default 0,
  new_followers integer default 0,
  messages integer default 0,
  orders_count integer default 0,
  revenue numeric(10,2) default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists ad_campaigns_dates_idx on ad_campaigns (start_date desc);
create index if not exists ad_campaigns_product_idx on ad_campaigns (product_id);

-- ── MONTHLY REPORT SETTINGS ─────────────────────────────────────────────────
create table if not exists report_settings (
  id integer primary key default 1,
  recipients text,
  include_financial boolean default true,
  include_restock boolean default true,
  include_sales boolean default true,
  updated_at timestamptz default now()
);

-- ============================================================================
-- PUBLIC WEBSITE / STOREFRONT
-- Anonymous visitors browse safe product fields, read reviews, validate coupon
-- codes and place an order. They can never read the customer list, other
-- people's orders, or cost prices — see server/policies.js.
-- ============================================================================

create table if not exists product_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id) on delete cascade,
  author_id uuid,                       -- app_users id when signed in
  author_name text,
  rating int not null check (rating between 1 and 5),
  comment text,
  approved boolean default true,
  created_at timestamptz default now()
);
create index if not exists product_reviews_product_idx on product_reviews(product_id);

create table if not exists coupons (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  discount_type text default 'percent',   -- percent | amount
  discount_value numeric(10,2) not null default 0,
  min_order numeric(10,2) default 0,
  active boolean default true,
  expires_on date,
  created_at timestamptz default now()
);

-- Editable website settings (hero text, promos, shipping fees, live toggle).
-- One row, id = 1, holding a JSON blob the back office edits and the shop reads.
create table if not exists site_settings (
  id int primary key default 1,
  data jsonb not null default '{}',
  updated_at timestamptz default now(),
  constraint site_settings_singleton check (id = 1)
);
insert into site_settings (id, data) values (1, '{}') on conflict (id) do nothing;

-- Signed-in customer profiles (saved delivery details).
create table if not exists customer_profiles (
  id uuid primary key references app_users(id) on delete cascade,
  full_name text, phone text, island text, address text, notes text, email text,
  updated_at timestamptz default now()
);

-- Safe, public view of products. cost_price is deliberately NOT selected, so it
-- is never exposed. Includes review aggregates for "top rated" sorting.
drop view if exists shop_products;
create view shop_products as
  select p.id, p.name, p.category, p.age_range, p.brand, p.sku, p.stock_qty, p.sell_price, p.sale_price,
         p.description, p.photo_url, p.images, p.safety_warnings, p.battery, p.materials, p.video_url,
         p.featured, p.badge, p.created_at,
         coalesce(r.avg_rating, 0) as avg_rating,
         coalesce(r.review_count, 0) as review_count
  from products p
  left join (
    select product_id, round(avg(rating)::numeric, 2) as avg_rating, count(*) as review_count
    from product_reviews where approved group by product_id
  ) r on r.product_id = p.id
  where coalesce(p.discontinued, false) = false;

-- Check a coupon without exposing the coupon list. The API calls this for
-- anonymous shoppers; the table itself stays staff-only.
create or replace function validate_coupon(p_code text, p_subtotal numeric)
returns table(valid boolean, discount_type text, discount_value numeric, message text)
language plpgsql as $$
declare c coupons;
begin
  select * into c from coupons where lower(code) = lower(trim(p_code)) limit 1;
  if not found then return query select false, null::text, 0::numeric, 'Invalid code'; return; end if;
  if not c.active then return query select false, null::text, 0::numeric, 'This code is no longer active'; return; end if;
  if c.expires_on is not null and c.expires_on < current_date then
    return query select false, null::text, 0::numeric, 'This code has expired'; return; end if;
  if p_subtotal < coalesce(c.min_order, 0) then
    return query select false, null::text, 0::numeric, 'Order total is below this code''s minimum'; return; end if;
  return query select true, c.discount_type, c.discount_value, 'Applied';
end $$;

-- ============================================================================
-- UPGRADE PATH
-- Columns added after a database was first built. `add column if not exists`
-- means this whole file can be re-run against a live database to bring it up to
-- date without touching the data.
-- ============================================================================
alter table orders            add column if not exists fulfilment text default 'delivery';
alter table orders            add column if not exists stock_deducted boolean default false;
alter table orders            add column if not exists delivery_time text;
alter table supplier_products add column if not exists cost_usd numeric;
alter table supplier_products add column if not exists is_favorite boolean default false;
alter table order_analyses    add column if not exists usd_rate numeric default 15.42;
alter table order_analysis_items add column if not exists sizes text;
alter table supplier_payments add column if not exists slips jsonb default '[]'::jsonb;
alter table supplier_payments add column if not exists payment_references jsonb default '[]'::jsonb;
alter table suppliers         add column if not exists is_overseas boolean default false;
alter table loans             add column if not exists lenders jsonb default '[]'::jsonb;
alter table products          add column if not exists variant_group text;
alter table products          add column if not exists variant_label text;

-- Columns that were added straight to the live database over the years and
-- never written down anywhere. The move off Supabase found them by comparing
-- the two databases row by row; without these six, `payment_terms` would have
-- vanished from every vendor and `slip_url` would have taken the payment slip
-- off every batch order.
alter table suppliers         add column if not exists payment_terms text;
alter table suppliers         add column if not exists currency text default 'MVR';
alter table purchase_orders   add column if not exists slip_url text;
alter table supplier_products add column if not exists product_id uuid;
alter table supplier_products add column if not exists supplier_sku text;
alter table supplier_products add column if not exists moq numeric;
