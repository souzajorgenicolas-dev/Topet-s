-- Topet's Lanches catalog. Run this in Supabase SQL Editor as project owner.
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_topets_admin()
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;
revoke all on function public.is_topets_admin() from public;
grant execute on function public.is_topets_admin() to anon, authenticated;

create table if not exists public.products (
  id text primary key,
  category text not null,
  name text not null,
  price numeric(10,2) not null check (price >= 0),
  description text not null default '',
  image_url text not null default '',
  active boolean not null default true,
  topping_limit integer check (topping_limit is null or topping_limit between 0 and 30),
  sort_order integer not null default 0,
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists products_active_order_idx on public.products (active, sort_order, name);

create table if not exists public.store_settings (
  id integer primary key check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;
alter table public.products enable row level security;
alter table public.store_settings enable row level security;

drop policy if exists "admins read own authorization" on public.admin_users;
create policy "admins read own authorization" on public.admin_users
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "public read active products and admins read all" on public.products;
create policy "public read active products and admins read all" on public.products
  for select to anon, authenticated using (active or public.is_topets_admin());
drop policy if exists "admins insert products" on public.products;
create policy "admins insert products" on public.products
  for insert to authenticated with check (public.is_topets_admin());
drop policy if exists "admins update products" on public.products;
create policy "admins update products" on public.products
  for update to authenticated using (public.is_topets_admin()) with check (public.is_topets_admin());
drop policy if exists "admins delete products" on public.products;
create policy "admins delete products" on public.products
  for delete to authenticated using (public.is_topets_admin());

drop policy if exists "public read store settings" on public.store_settings;
create policy "public read store settings" on public.store_settings
  for select to anon, authenticated using (true);
drop policy if exists "admins update store settings" on public.store_settings;
create policy "admins update store settings" on public.store_settings
  for update to authenticated using (public.is_topets_admin()) with check (public.is_topets_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = true, file_size_limit = 5242880, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public read product images" on storage.objects;
create policy "public read product images" on storage.objects
  for select to anon, authenticated using (bucket_id = 'product-images');
drop policy if exists "admins upload product images" on storage.objects;
create policy "admins upload product images" on storage.objects
  for insert to authenticated with check (bucket_id = 'product-images' and public.is_topets_admin());
drop policy if exists "admins update product images" on storage.objects;
create policy "admins update product images" on storage.objects
  for update to authenticated using (bucket_id = 'product-images' and public.is_topets_admin())
  with check (bucket_id = 'product-images' and public.is_topets_admin());
drop policy if exists "admins delete product images" on storage.objects;
create policy "admins delete product images" on storage.objects
  for delete to authenticated using (bucket_id = 'product-images' and public.is_topets_admin());

grant select on public.products, public.store_settings to anon, authenticated;
grant insert, update, delete on public.products to authenticated;
grant update on public.store_settings to authenticated;
grant select on public.admin_users to authenticated;
