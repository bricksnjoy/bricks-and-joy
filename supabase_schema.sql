-- ============================================================
-- BRICKS & JOY — SUPABASE DATABASE SETUP
-- Run this entire file in your Supabase SQL Editor
-- ============================================================

-- CUSTOMERS
create table customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  instagram text,
  phone text,
  address text,
  landmark text,
  notes text,
  created_at timestamptz default now(),
  created_by uuid references auth.users(id)
);
-- For existing databases:
-- alter table customers add column if not exists instagram text;
-- alter table customers add column if not exists landmark text;

-- SUPPLIERS
create table suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  email text,
  phone text,
  address text,
  notes text,
  created_at timestamptz default now()
);

-- PRODUCTS (inventory)
create table products (
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
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ORDERS (sales to customers)
create table orders (
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
  notes text,
  created_at timestamptz default now(),
  created_by uuid references auth.users(id),
  created_by_email text
);
-- For existing databases:
-- alter table orders add column if not exists delivery_person text;
-- alter table orders add column if not exists delivery_date date;
-- alter table orders add column if not exists created_by_email text;

-- PURCHASE ORDERS (buying from suppliers)
create table purchase_orders (
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
  created_at timestamptz default now(),
  created_by uuid references auth.users(id)
);

-- EXPENSES
create table expenses (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  category text not null,
  amount numeric(10,2) not null default 0,
  expense_date date default current_date,
  created_at timestamptz default now(),
  created_by uuid references auth.users(id)
);

-- EMAIL CONTACTS (replaces localStorage)
create table email_contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  role text,
  phone text,
  created_at timestamptz default now()
);

-- SUPPLIER PRODUCT CATALOG
create table supplier_products (
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
  is_favorite boolean default false,   -- shared favourite flag, synced across all devices
  created_at timestamptz default now()
);
-- For existing databases: alter table supplier_products add column if not exists custom_fields jsonb;
-- For existing databases: alter table supplier_products add column if not exists is_favorite boolean default false;

-- PRODUCT CATEGORIES
create table categories (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  color text default '#FFA500',
  created_at timestamptz default now()
);

-- SEASONAL CAMPAIGN PLANS (Planning tab)
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  occasion_date date not null,         -- the event date (yearly recurring by month/day)
  emoji text,
  lead_days int default 90,            -- start prep this many days before
  notify_email text,
  recurring boolean default true,
  plan jsonb,                          -- generated plan: summary, stock-up, packages, marketing, checklist
  last_notified_year int,              -- year the 90-day prep reminder was last emailed (avoids dupes)
  notified_30_year int,                -- year the 30-day final-push reminder was last emailed
  created_at timestamptz default now()
);
-- For existing databases: alter table campaigns add column if not exists notified_30_year int;

-- EVENTS & GIVEAWAYS (Events tab: ideas → planned → done, with results + cost)
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text default 'idea',            -- idea | planned | done
  platform text,                         -- Instagram, TikTok, In-store, …
  event_date date,                       -- when it runs / ran
  prep_date date,                        -- when to start preparing
  description text,                      -- the idea / notes
  impressions int default 0,             -- results (for executed events)
  reach int default 0,
  likes int default 0,
  comments int default 0,
  shares int default 0,
  saves int default 0,
  results_notes text,
  cash_amount numeric(10,2) default 0,   -- cash portion of the cost
  cash_category text default 'Promotions',
  cash_expense_id uuid,                  -- linked expenses row for the cash cost
  product_cost numeric(10,2) default 0,  -- cached sum of giveaway product costs
  created_at timestamptz default now(),
  created_by uuid references auth.users(id)
);

-- Products handed out as part of an event. Each row is one committed stock
-- movement; expense_id links it to the accounting entry it created.
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

-- SUPPLIER PAYMENTS
create table supplier_payments (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid references purchase_orders(id) on delete cascade,
  supplier_id uuid references suppliers(id) on delete set null,
  supplier_name text,
  amount numeric(10,2) not null,
  payment_date date default current_date,
  payment_method text default 'Bank Transfer',
  reference text,
  notes text,
  slips jsonb,
  batch_no text,
  created_at timestamptz default now()
);

-- For existing databases, add the new columns:
-- alter table supplier_payments add column if not exists slips jsonb;
-- alter table supplier_payments add column if not exists batch_no text;
-- alter table purchase_orders add column if not exists batch_no text;

-- USER PROFILES (extends Supabase auth)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text default 'staff',
  created_at timestamptz default now()
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ROW LEVEL SECURITY (all authenticated users can access all data)
alter table customers enable row level security;
alter table suppliers enable row level security;
alter table products enable row level security;
alter table orders enable row level security;
alter table purchase_orders enable row level security;
alter table expenses enable row level security;
alter table email_contacts enable row level security;
alter table supplier_products enable row level security;
alter table categories enable row level security;
alter table supplier_payments enable row level security;
alter table events enable row level security;
alter table event_giveaways enable row level security;
alter table profiles enable row level security;

-- Policies: any logged-in user can read/write everything
create policy "Authenticated users can do everything" on customers for all using (auth.role() = 'authenticated');
create policy "Authenticated users can do everything" on suppliers for all using (auth.role() = 'authenticated');
create policy "Authenticated users can do everything" on products for all using (auth.role() = 'authenticated');
create policy "Authenticated users can do everything" on orders for all using (auth.role() = 'authenticated');
create policy "Authenticated users can do everything" on purchase_orders for all using (auth.role() = 'authenticated');
create policy "Authenticated users can do everything" on expenses for all using (auth.role() = 'authenticated');
create policy "Authenticated users can do everything" on email_contacts for all using (auth.role() = 'authenticated');
create policy "Authenticated users can do everything" on supplier_products for all using (auth.role() = 'authenticated');
create policy "Authenticated users can do everything" on categories for all using (auth.role() = 'authenticated');
create policy "Authenticated users can do everything" on supplier_payments for all using (auth.role() = 'authenticated');
create policy "Authenticated users can do everything" on events for all using (auth.role() = 'authenticated');
create policy "Authenticated users can do everything" on event_giveaways for all using (auth.role() = 'authenticated');
create policy "Users can view all profiles" on profiles for select using (auth.role() = 'authenticated');
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);
