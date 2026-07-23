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
-- alter table orders add column if not exists fulfilment text default 'delivery';  -- 'delivery' | 'pickup'

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
  followers int default 0,               -- new followers gained
  results_notes text,
  cash_amount numeric(10,2) default 0,   -- cached sum of the cash cost lines
  cash_items jsonb,                      -- [{ label, amount, category, expense_id }]
  cash_category text default 'Promotions', -- (legacy, kept for old rows)
  cash_expense_id uuid,                  -- (legacy, kept for old rows)
  product_cost numeric(10,2) default 0,  -- cached sum of giveaway product costs
  images jsonb,                          -- array of image URLs (story screenshots, etc.)
  created_at timestamptz default now(),
  created_by uuid references auth.users(id)
);
-- For existing databases:
-- alter table events add column if not exists followers int default 0;
-- alter table events add column if not exists cash_items jsonb;
-- alter table events add column if not exists images jsonb;

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

-- ============================================================
-- PUBLIC WEBSITE / STOREFRONT
-- Homepage is at the site root; the admin back office moves to
-- /backoffice. Anonymous visitors can browse safe product fields,
-- read reviews, validate coupon codes, and place an order — they
-- can never read the customer list, other orders, or cost prices.
-- ============================================================

-- Extra product fields shown on the website (fill these in from Inventory).
alter table products add column if not exists safety_warnings text;
alter table products add column if not exists battery text;          -- e.g. "2 × AA (not included)"
alter table products add column if not exists materials text;        -- e.g. "ABS plastic, BPA-free"
alter table products add column if not exists video_url text;        -- demo video (YouTube link or mp4)
alter table products add column if not exists featured boolean default false;  -- show on the homepage
alter table products add column if not exists badge text;            -- e.g. "New", "Sale", "Seasonal"
alter table products add column if not exists sale_price numeric(10,2);  -- optional sale price (shows original struck through)
alter table products add column if not exists images jsonb;          -- extra product photos (array of URLs); photo_url stays the main one

-- Customer product reviews
create table if not exists product_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id) on delete cascade,
  author_id uuid,                       -- auth.users id when signed in
  author_name text,
  rating int not null check (rating between 1 and 5),
  comment text,
  approved boolean default true,
  created_at timestamptz default now()
);
alter table product_reviews enable row level security;
drop policy if exists "Anyone can read reviews" on product_reviews;
drop policy if exists "Signed-in can write reviews" on product_reviews;
create policy "Anyone can read reviews"      on product_reviews for select using (true);
create policy "Signed-in can write reviews"  on product_reviews for insert to authenticated with check (true);
grant select on product_reviews to anon, authenticated;
grant insert on product_reviews to authenticated;

-- Coupon codes
create table if not exists coupons (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  discount_type text default 'percent', -- percent | amount
  discount_value numeric(10,2) not null default 0,
  min_order numeric(10,2) default 0,
  active boolean default true,
  expires_on date,
  created_at timestamptz default now()
);
-- Example: insert into coupons (code, discount_type, discount_value) values ('WELCOME10','percent',10);

-- Safe, public view of products. cost_price is deliberately NOT selected, so it
-- is never exposed. Includes review aggregates for "top rated" sorting.
-- DROP first: the column list changed, and create-or-replace can't reorder columns.
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

grant select on shop_products to anon, authenticated;

-- Validate a coupon without exposing the whole coupon list to the public.
create or replace function validate_coupon(p_code text, p_subtotal numeric)
returns table(valid boolean, discount_type text, discount_value numeric, message text)
language plpgsql security definer set search_path = public as $$
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
grant execute on function validate_coupon(text, numeric) to anon, authenticated;

-- Coupons: staff (back office) manage them; the public never reads the table
-- directly (only via validate_coupon).
alter table coupons enable row level security;
drop policy if exists "Staff manage coupons" on coupons;
create policy "Staff manage coupons" on coupons for all to authenticated using (true) with check (true);
grant all on coupons to authenticated;

-- Editable website settings (hero text, promos, shipping fees, live toggle, …).
-- A single row (id = 1) holding a JSON blob the back office edits and the shop reads.
create table if not exists site_settings (
  id int primary key default 1,
  data jsonb not null default '{}',
  updated_at timestamptz default now(),
  constraint site_settings_singleton check (id = 1)
);
insert into site_settings (id, data) values (1, '{}') on conflict (id) do nothing;
alter table site_settings enable row level security;
drop policy if exists "Anyone can read site settings" on site_settings;
drop policy if exists "Staff can update site settings" on site_settings;
create policy "Anyone can read site settings"   on site_settings for select using (true);
create policy "Staff can update site settings"  on site_settings for all to authenticated using (true) with check (true);
grant select on site_settings to anon, authenticated;
grant all on site_settings to authenticated;

-- Signed-in customer profiles (saved delivery details). Each shopper can only
-- read/write their OWN row — never anyone else's.
create table if not exists customer_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text, phone text, island text, address text, notes text, email text,
  updated_at timestamptz default now()
);
alter table customer_profiles enable row level security;
drop policy if exists "Users manage own profile" on customer_profiles;
create policy "Users manage own profile" on customer_profiles for all to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);
grant all on customer_profiles to authenticated;

-- Let anonymous website visitors create their customer record and place an order.
-- INSERT only — anon still cannot select, update, or delete anything.
drop policy if exists "Public can create customers" on customers;
drop policy if exists "Public can place orders" on orders;
create policy "Public can create customers" on customers for insert to anon with check (true);
create policy "Public can place orders"     on orders    for insert to anon with check (true);

-- Signed-in customers can read their OWN orders (for the account page's order history).
drop policy if exists "Customers read own orders" on orders;
create policy "Customers read own orders" on orders for select to authenticated using (customer_id = auth.uid());
