-- ============================================================
-- BRICKS & JOY — SUPABASE DATABASE SETUP
-- Run this entire file in your Supabase SQL Editor
-- ============================================================

-- CUSTOMERS
create table customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  address text,
  notes text,
  created_at timestamptz default now(),
  created_by uuid references auth.users(id)
);

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
  notes text,
  created_at timestamptz default now(),
  created_by uuid references auth.users(id)
);

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
alter table profiles enable row level security;

-- Policies: any logged-in user can read/write everything
create policy "Authenticated users can do everything" on customers for all using (auth.role() = 'authenticated');
create policy "Authenticated users can do everything" on suppliers for all using (auth.role() = 'authenticated');
create policy "Authenticated users can do everything" on products for all using (auth.role() = 'authenticated');
create policy "Authenticated users can do everything" on orders for all using (auth.role() = 'authenticated');
create policy "Authenticated users can do everything" on purchase_orders for all using (auth.role() = 'authenticated');
create policy "Authenticated users can do everything" on expenses for all using (auth.role() = 'authenticated');
create policy "Users can view all profiles" on profiles for select using (auth.role() = 'authenticated');
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);
