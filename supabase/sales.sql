-- Topet's Lanches — migration de vendas confirmadas.
-- Execute uma vez no Supabase SQL Editor após schema.sql. É aditiva: não altera
-- o catálogo e não importa pedidos do WhatsApp.

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  sold_at timestamptz not null,
  products_subtotal numeric(10,2) not null check (products_subtotal >= 0),
  discount numeric(10,2) not null default 0 check (discount >= 0),
  delivery_fee numeric(10,2) not null default 0 check (delivery_fee >= 0),
  total numeric(10,2) not null check (total >= 0),
  payment_method text not null check (length(trim(payment_method)) > 0),
  notes text not null default '',
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  cancel_reason text not null default '',
  cancelled_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (discount <= products_subtotal),
  check (total = products_subtotal - discount + delivery_fee)
);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id text references public.products(id) on delete set null,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(10,2) not null check (unit_price >= 0),
  extra_unit_price numeric(10,2) not null default 0 check (extra_unit_price >= 0),
  customizations text not null default '',
  subtotal numeric(10,2) not null check (subtotal >= 0),
  created_at timestamptz not null default now()
);

create index if not exists sales_sold_at_idx on public.sales (sold_at desc);
create index if not exists sales_status_sold_at_idx on public.sales (status, sold_at desc);
create index if not exists sale_items_sale_id_idx on public.sale_items (sale_id);
create index if not exists sale_items_product_name_idx on public.sale_items (product_name);

alter table public.sales enable row level security;
alter table public.sale_items enable row level security;

drop policy if exists "admins read sales" on public.sales;
create policy "admins read sales" on public.sales
  for select to authenticated using (public.is_topets_admin());
drop policy if exists "admins read sale items" on public.sale_items;
create policy "admins read sale items" on public.sale_items
  for select to authenticated using (public.is_topets_admin());

-- Writes go only through the RPCs below, so a header cannot be saved without
-- its items. The functions check the existing admin_users authorization.
revoke all on public.sales, public.sale_items from anon, authenticated;
grant select on public.sales, public.sale_items to authenticated;

create or replace function public.save_topets_sale(
  p_sale_id uuid,
  p_sale jsonb,
  p_items jsonb,
  p_is_new boolean
) returns uuid
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_id uuid;
  v_subtotal numeric(10,2) := 0;
  v_discount numeric(10,2);
  v_delivery numeric(10,2);
  v_total numeric(10,2);
  v_item jsonb;
  v_qty integer;
  v_price numeric(10,2);
  v_extra numeric(10,2);
  v_line numeric(10,2);
  v_name text;
  v_method text;
  v_sold_at timestamptz;
begin
  if not public.is_topets_admin() then raise exception 'Acesso restrito a administradores.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Inclua ao menos um produto.'; end if;
  v_discount := coalesce(nullif(p_sale->>'discount', '')::numeric, 0);
  v_delivery := coalesce(nullif(p_sale->>'delivery_fee', '')::numeric, 0);
  v_method := nullif(trim(p_sale->>'payment_method'), '');
  v_sold_at := nullif(p_sale->>'sold_at', '')::timestamptz;
  if v_sold_at is null or v_method is null or v_discount < 0 or v_delivery < 0 then raise exception 'Confira data, pagamento, desconto e entrega.'; end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::integer;
    v_price := (v_item->>'unit_price')::numeric(10,2);
    v_extra := coalesce(nullif(v_item->>'extra_unit_price', '')::numeric, 0);
    v_name := nullif(trim(v_item->>'product_name'), '');
    if v_qty <= 0 or v_price < 0 or v_extra < 0 or v_name is null then raise exception 'Confira os itens, quantidades e preços.'; end if;
    v_line := round((v_price + v_extra) * v_qty, 2);
    v_subtotal := v_subtotal + v_line;
  end loop;
  if v_discount > v_subtotal then raise exception 'O desconto não pode superar o valor dos produtos.'; end if;
  v_total := v_subtotal - v_discount + v_delivery;

  if p_is_new then
    insert into public.sales (sold_at, products_subtotal, discount, delivery_fee, total, payment_method, notes, created_by)
    values (v_sold_at, v_subtotal, v_discount, v_delivery, v_total, v_method, coalesce(p_sale->>'notes', ''), auth.uid())
    returning id into v_id;
  else
    v_id := p_sale_id;
    update public.sales set sold_at = v_sold_at, products_subtotal = v_subtotal, discount = v_discount,
      delivery_fee = v_delivery, total = v_total, payment_method = v_method,
      notes = coalesce(p_sale->>'notes', ''), updated_at = now()
    where id = v_id and status = 'confirmed';
    if not found then raise exception 'Venda não encontrada ou já cancelada.'; end if;
    delete from public.sale_items where sale_id = v_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::integer;
    v_price := (v_item->>'unit_price')::numeric(10,2);
    v_extra := coalesce(nullif(v_item->>'extra_unit_price', '')::numeric, 0);
    v_name := trim(v_item->>'product_name');
    v_line := round((v_price + v_extra) * v_qty, 2);
    insert into public.sale_items (sale_id, product_id, product_name, quantity, unit_price, extra_unit_price, customizations, subtotal)
    values (v_id, nullif(v_item->>'product_id', ''), v_name, v_qty, v_price, v_extra, coalesce(v_item->>'customizations', ''), v_line);
  end loop;
  return v_id;
end;
$$;

create or replace function public.record_topets_sale(p_sale jsonb, p_items jsonb)
returns uuid language sql security definer set search_path = public set row_security = off
as $$ select public.save_topets_sale(null, p_sale, p_items, true); $$;

create or replace function public.update_topets_sale(p_sale_id uuid, p_sale jsonb, p_items jsonb)
returns uuid language sql security definer set search_path = public set row_security = off
as $$ select public.save_topets_sale(p_sale_id, p_sale, p_items, false); $$;

create or replace function public.cancel_topets_sale(p_sale_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public set row_security = off
as $$
begin
  if not public.is_topets_admin() then raise exception 'Acesso restrito a administradores.'; end if;
  update public.sales set status = 'cancelled', cancel_reason = coalesce(nullif(trim(p_reason), ''), 'Motivo não informado'), cancelled_at = now(), updated_at = now()
    where id = p_sale_id and status = 'confirmed';
  if not found then raise exception 'Venda não encontrada ou já cancelada.'; end if;
end;
$$;

revoke all on function public.save_topets_sale(uuid, jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.record_topets_sale(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.update_topets_sale(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.cancel_topets_sale(uuid, text) from public, anon, authenticated;
grant execute on function public.record_topets_sale(jsonb, jsonb) to authenticated;
grant execute on function public.update_topets_sale(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.cancel_topets_sale(uuid, text) to authenticated;
