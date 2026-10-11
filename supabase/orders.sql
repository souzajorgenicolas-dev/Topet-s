-- Topet's Lanches — pedidos do site integrados às vendas.
-- Execute depois de schema.sql e sales.sql. A migração é aditiva e idempotente.
-- Clientes anônimos só podem chamar create_topets_order; não podem ler tabelas,
-- definir status nem confirmar vendas. Confirmação é exclusiva do admin.

create table if not exists public.customer_orders (
  id uuid primary key default gen_random_uuid(),
  client_request_id uuid not null unique,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'not_concretized')),
  sale_id uuid unique references public.sales(id) on delete restrict,
  customer_name text not null,
  phone text not null,
  fulfillment text not null check (fulfillment in ('delivery', 'pickup')),
  neighborhood text,
  address jsonb,
  payment_method text not null,
  needs_change boolean not null default false,
  change_for numeric(10,2),
  products_subtotal numeric(10,2) not null check (products_subtotal >= 0),
  discount numeric(10,2) not null default 0 check (discount >= 0),
  delivery_fee numeric(10,2) check (delivery_fee is null or delivery_fee >= 0),
  consult_delivery boolean not null default false,
  total numeric(10,2) check (total is null or total >= 0),
  notes text not null default '',
  non_concretized_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'confirmed') = (sale_id is not null)),
  check ((fulfillment = 'delivery') or (neighborhood is null and address is null and consult_delivery = false)),
  check ((consult_delivery and delivery_fee is null and total is null) or (not consult_delivery and delivery_fee is not null and total is not null)),
  check ((needs_change and payment_method = 'Dinheiro' and change_for is not null) or (not needs_change and change_for is null))
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.customer_orders(id) on delete cascade,
  product_id text references public.products(id) on delete set null,
  product_name text not null,
  category text not null,
  quantity integer not null check (quantity between 1 and 100),
  base_unit_price numeric(10,2) not null check (base_unit_price >= 0),
  extra_unit_price numeric(10,2) not null default 0 check (extra_unit_price >= 0),
  unit_price numeric(10,2) not null check (unit_price = base_unit_price + extra_unit_price),
  extras jsonb not null default '[]'::jsonb check (jsonb_typeof(extras) = 'array'),
  toppings jsonb not null default '[]'::jsonb check (jsonb_typeof(toppings) = 'array'),
  item_notes text not null default '',
  subtotal numeric(10,2) not null check (subtotal = unit_price * quantity),
  created_at timestamptz not null default now()
);

create index if not exists customer_orders_status_created_at_idx on public.customer_orders (status, created_at desc);
create index if not exists customer_orders_sale_id_idx on public.customer_orders (sale_id) where sale_id is not null;
create index if not exists order_items_order_id_idx on public.order_items (order_id);
create index if not exists order_items_product_id_idx on public.order_items (product_id);

alter table public.customer_orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "admins read customer orders" on public.customer_orders;
create policy "admins read customer orders" on public.customer_orders
  for select to authenticated using (public.is_topets_admin());
drop policy if exists "admins read order items" on public.order_items;
create policy "admins read order items" on public.order_items
  for select to authenticated using (public.is_topets_admin());

revoke all on public.customer_orders, public.order_items from anon, authenticated;
grant select on public.customer_orders, public.order_items to authenticated;

create or replace function public.create_topets_order(p_request_id uuid, p_order jsonb, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_existing uuid;
  v_order_id uuid;
  v_item jsonb;
  v_extra jsonb;
  v_topping text;
  v_product public.products%rowtype;
  v_addon public.products%rowtype;
  v_qty integer;
  v_base numeric(10,2);
  v_extras_total numeric(10,2);
  v_unit numeric(10,2);
  v_line numeric(10,2);
  v_subtotal numeric(10,2) := 0;
  v_extra_rows jsonb;
  v_delivery numeric(10,2);
  v_total numeric(10,2);
  v_consult boolean;
  v_fulfillment text;
  v_payment text;
  v_needs_change boolean;
  v_change_for numeric(10,2);
  v_customer text;
  v_phone text;
  v_valid_neighborhood boolean;
  v_payment_configured boolean;
  v_topping_limit integer;
  v_topping_rows jsonb;
begin
  if p_request_id is null then raise exception 'Identificador de envio inválido.'; end if;
  -- A repetição da mesma tentativa devolve apenas o mesmo UUID, nunca os dados.
  select id into v_existing from public.customer_orders where client_request_id = p_request_id;
  if found then return v_existing; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 50 then raise exception 'O pedido precisa conter de 1 a 50 itens.'; end if;

  v_customer := nullif(trim(p_order->>'customer_name'), '');
  v_phone := nullif(trim(p_order->>'phone'), '');
  if v_phone is not null and length(regexp_replace(v_phone, '[^0-9]', '', 'g')) not in (10, 11, 12, 13) then raise exception 'O telefone precisa incluir um DDD válido.'; end if;
  v_fulfillment := p_order->>'fulfillment';
  v_payment := nullif(trim(p_order->>'payment_method'), '');
  if v_customer is null or length(v_customer) > 120 or array_length(regexp_split_to_array(v_customer, '\s+'), 1) < 2 or v_phone is null or length(v_phone) > 30 then raise exception 'Informe nome completo e telefone.'; end if;
  if v_fulfillment is null or v_fulfillment not in ('delivery', 'pickup') or v_payment is null or length(v_payment) > 50 then raise exception 'Confira entrega e forma de pagamento.'; end if;
  if length(coalesce(p_order->>'notes', '')) > 2000 then raise exception 'As observações excedem o limite.'; end if;

  v_consult := coalesce((p_order->>'consult_delivery')::boolean, false) and v_fulfillment = 'delivery';
  v_needs_change := coalesce((p_order->>'needs_change')::boolean, false) and v_payment = 'Dinheiro';
  v_change_for := case when v_needs_change then nullif(p_order->>'change_for', '')::numeric else null end;
  v_delivery := case when v_fulfillment = 'pickup' then 0 when v_consult then null else nullif(p_order->>'delivery_fee', '')::numeric end;
  if v_fulfillment = 'delivery' and not v_consult and v_delivery is null then raise exception 'Taxa de entrega inválida.'; end if;
  if v_delivery is not null and v_delivery < 0 then raise exception 'Taxa de entrega inválida.'; end if;
  if v_fulfillment = 'delivery' then
    if v_consult then
      select exists(select 1 from public.store_settings s, jsonb_array_elements(coalesce(s.data->'neighborhoods', '[]'::jsonb)) as n(value)
        where coalesce((n.value->>'consultDelivery')::boolean, false)) into v_valid_neighborhood;
    else
      select exists(select 1 from public.store_settings s, jsonb_array_elements(coalesce(s.data->'neighborhoods', '[]'::jsonb)) as n(value)
        where (n.value->>'name') = (p_order->>'neighborhood')
          and not coalesce((n.value->>'consultDelivery')::boolean, false)
          and (n.value->>'deliveryFeeCents')::numeric = v_delivery * 100) into v_valid_neighborhood;
    end if;
    if not coalesce(v_valid_neighborhood, false) then raise exception 'O bairro ou a taxa de entrega mudou. Confira os dados e tente novamente.'; end if;
  end if;
  select exists(select 1 from public.store_settings s, jsonb_array_elements_text(coalesce(s.data->'paymentMethods', '[]'::jsonb)) as method(value) where method.value = v_payment) into v_payment_configured;
  if not coalesce(v_payment_configured, false) then raise exception 'A forma de pagamento selecionada não está disponível.'; end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_qty := nullif(v_item->>'quantity', '')::integer;
    if v_qty is null or v_qty < 1 or v_qty > 100 then raise exception 'Quantidade de item inválida.'; end if;
    select * into v_product from public.products where id = v_item->>'product_id' and active = true;
    if not found then raise exception 'Um produto do pedido não está mais disponível. Atualize o cardápio e tente novamente.'; end if;
    v_base := nullif(v_item->>'base_unit_price', '')::numeric(10,2);
    if v_base is null or v_base <> v_product.price then raise exception 'O preço do cardápio mudou. Atualize a página e confira a sacola.'; end if;
    v_extra_rows := coalesce(v_item->'extras', '[]'::jsonb);
    if jsonb_typeof(v_extra_rows) <> 'array' or jsonb_array_length(v_extra_rows) > 20 then raise exception 'Adicionais inválidos.'; end if;
    v_topping_rows := coalesce(v_item->'toppings', '[]'::jsonb);
    if jsonb_typeof(v_topping_rows) is distinct from 'array' or jsonb_array_length(v_topping_rows) > 30 then raise exception 'Personalizações inválidas.'; end if;
    if length(coalesce(v_item->>'item_notes', '')) > 500 then raise exception 'A observação de um item excede o limite.'; end if;
    v_extras_total := 0;
    for v_extra in select value from jsonb_array_elements(v_extra_rows) loop
      if jsonb_typeof(v_extra) is distinct from 'object' or nullif(trim(v_extra->>'name'), '') is null or nullif(v_extra->>'price', '') is null then raise exception 'Adicional inválido.'; end if;
      select * into v_addon from public.products where category = 'Adicionais' and active = true and name = v_extra->>'name' limit 1;
      if not found or v_addon.price <> (v_extra->>'price')::numeric then raise exception 'O preço de um adicional mudou. Atualize a página e tente novamente.'; end if;
      v_extras_total := v_extras_total + v_addon.price;
    end loop;
    if v_product.category = 'Açaí' then
      v_topping_limit := coalesce(v_product.topping_limit, case when v_product.name ilike '%barca%' then 7 when v_product.name ilike '%1 litro%' then 5 else 3 end);
      if jsonb_array_length(v_topping_rows) > v_topping_limit then raise exception 'O açaí excede o limite de acompanhamentos.'; end if;
      if exists(select 1 from jsonb_array_elements(v_topping_rows) as topping(value) where jsonb_typeof(topping.value) <> 'string') then raise exception 'Acompanhamento inválido.'; end if;
      for v_topping in select value from jsonb_array_elements_text(v_topping_rows) loop
        if length(v_topping) > 80
          or not exists(select 1 from public.store_settings s, jsonb_array_elements_text(coalesce(s.data->'acaiToppings', '[]'::jsonb)) as topping(value) where topping.value = v_topping)
          then raise exception 'Acompanhamento inválido.'; end if;
      end loop;
    elsif jsonb_array_length(v_topping_rows) > 0 then raise exception 'Este produto não aceita acompanhamentos de açaí.';
    end if;
    v_unit := v_base + v_extras_total;
    if nullif(v_item->>'unit_price', '') is null or v_unit <> (v_item->>'unit_price')::numeric(10,2) then raise exception 'O preço de um item não confere. Atualize a página e tente novamente.'; end if;
    v_line := v_unit * v_qty;
    v_subtotal := v_subtotal + v_line;
  end loop;
  if nullif(p_order->>'products_subtotal', '') is null or v_subtotal <> (p_order->>'products_subtotal')::numeric(10,2) then raise exception 'O subtotal mudou. Confira a sacola e tente novamente.'; end if;
  if v_needs_change and (v_change_for is null or v_change_for <= v_subtotal + coalesce(v_delivery, 0)) then raise exception 'O valor informado para troco não é suficiente.'; end if;
  if v_fulfillment = 'delivery' then
    if nullif(trim(p_order->>'neighborhood'), '') is null or jsonb_typeof(p_order->'address') is distinct from 'object' then raise exception 'Endereço ou bairro inválido.'; end if;
    if length(coalesce(p_order->'address'->>'street', '')) not between 1 and 180
      or length(coalesce(p_order->'address'->>'house_number', '')) not between 1 and 40
      or coalesce(p_order->'address'->>'residence_type', '') not in ('Casa', 'Apartamento')
      or length(coalesce(p_order->'address'->>'complement', '')) > 200
      or length(coalesce(p_order->'address'->>'reference', '')) > 200 then raise exception 'Confira rua, número e complemento do endereço.'; end if;
    if p_order->'address'->>'residence_type' = 'Apartamento'
      and (length(coalesce(p_order->'address'->>'apartment_number', '')) not between 1 and 40
        or length(coalesce(p_order->'address'->>'block', '')) not between 1 and 40) then raise exception 'Informe apartamento e bloco.'; end if;
  end if;
  v_total := case when v_consult then null else v_subtotal + coalesce(v_delivery, 0) end;
  if (v_consult and p_order->>'total' is not null) or (not v_consult and nullif(p_order->>'total', '')::numeric is distinct from v_total) then raise exception 'O total informado não confere com os valores do pedido.'; end if;

  insert into public.customer_orders (client_request_id, customer_name, phone, fulfillment, neighborhood, address,
    payment_method, needs_change, change_for, products_subtotal, discount, delivery_fee, consult_delivery, total, notes)
  values (p_request_id, v_customer, v_phone, v_fulfillment,
    case when v_fulfillment = 'delivery' then trim(p_order->>'neighborhood') else null end,
    case when v_fulfillment = 'delivery' then p_order->'address' else null end,
    v_payment, v_needs_change, v_change_for, v_subtotal, 0, v_delivery, v_consult, v_total, coalesce(p_order->>'notes', ''))
  on conflict (client_request_id) do nothing
  returning id into v_order_id;
  if v_order_id is null then
    select id into v_order_id from public.customer_orders where client_request_id = p_request_id;
    return v_order_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    select * into v_product from public.products where id = v_item->>'product_id';
    v_qty := (v_item->>'quantity')::integer;
    v_base := v_product.price;
    v_extra_rows := coalesce(v_item->'extras', '[]'::jsonb);
    select coalesce(sum((extra.value->>'price')::numeric), 0) into v_extras_total from jsonb_array_elements(v_extra_rows) as extra(value);
    v_unit := v_base + v_extras_total;
    insert into public.order_items (order_id, product_id, product_name, category, quantity, base_unit_price,
      extra_unit_price, unit_price, extras, toppings, item_notes, subtotal)
    values (v_order_id, v_product.id, v_product.name, v_product.category, v_qty, v_base, v_extras_total, v_unit,
      v_extra_rows, coalesce(v_item->'toppings', '[]'::jsonb), coalesce(v_item->>'item_notes', ''), v_unit * v_qty);
  end loop;
  return v_order_id;
exception when unique_violation then
  select id into v_existing from public.customer_orders where client_request_id = p_request_id;
  if v_existing is not null then return v_existing; end if;
  raise;
end;
$$;

create or replace function public.confirm_topets_order(p_order_id uuid, p_delivery_fee numeric default null)
returns uuid
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_order public.customer_orders%rowtype;
  v_sale_id uuid;
  v_delivery numeric(10,2);
  v_total numeric(10,2);
  v_notes text;
  v_item record;
  v_customizations text;
begin
  if not public.is_topets_admin() then raise exception 'Acesso restrito a administradores.'; end if;
  select * into v_order from public.customer_orders where id = p_order_id for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if v_order.status = 'confirmed' and v_order.sale_id is not null then return v_order.sale_id; end if;
  if v_order.status <> 'pending' then raise exception 'Somente pedidos pendentes podem ser confirmados.'; end if;
  if v_order.fulfillment = 'pickup' then v_delivery := 0;
  else v_delivery := coalesce(p_delivery_fee, v_order.delivery_fee);
    if v_delivery is null then raise exception 'Informe a taxa de entrega acordada com o cliente.'; end if;
  end if;
  if v_delivery < 0 then raise exception 'Taxa de entrega inválida.'; end if;
  v_total := v_order.products_subtotal - v_order.discount + v_delivery;
  v_notes := concat_ws(E'\n', nullif(v_order.notes, ''), 'Pedido do site #' || left(v_order.id::text, 8));

  insert into public.sales (sold_at, products_subtotal, discount, delivery_fee, total, payment_method, notes, created_by)
  values (now(), v_order.products_subtotal, v_order.discount, v_delivery, v_total, v_order.payment_method, v_notes, auth.uid())
  returning id into v_sale_id;

  for v_item in select * from public.order_items where order_id = v_order.id order by created_at, id loop
    select concat_ws(' | ',
      case when jsonb_array_length(v_item.toppings) > 0 then 'Acompanhamentos: ' || (select string_agg(value, ', ') from jsonb_array_elements_text(v_item.toppings)) end,
      case when jsonb_array_length(v_item.extras) > 0 then 'Adicionais: ' || (select string_agg(extra.value->>'name', ', ') from jsonb_array_elements(v_item.extras) as extra(value)) end,
      nullif(v_item.item_notes, '')) into v_customizations;
    insert into public.sale_items (sale_id, product_id, product_name, quantity, unit_price, extra_unit_price, customizations, subtotal)
    values (v_sale_id, v_item.product_id, v_item.product_name, v_item.quantity, v_item.base_unit_price,
      v_item.extra_unit_price, coalesce(v_customizations, ''), v_item.subtotal);
  end loop;

  update public.customer_orders set status = 'confirmed', sale_id = v_sale_id,
    delivery_fee = v_delivery, total = v_total, updated_at = now() where id = v_order.id;
  return v_sale_id;
end;
$$;

create or replace function public.mark_topets_order_not_concretized(p_order_id uuid, p_reason text default '')
returns text
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare v_order public.customer_orders%rowtype;
begin
  if not public.is_topets_admin() then raise exception 'Acesso restrito a administradores.'; end if;
  select * into v_order from public.customer_orders where id = p_order_id for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if v_order.status = 'confirmed' then raise exception 'Este pedido já foi vinculado a uma venda.'; end if;
  if v_order.status = 'not_concretized' then return v_order.status; end if;
  update public.customer_orders set status = 'not_concretized', non_concretized_reason = left(coalesce(nullif(trim(p_reason), ''), 'Motivo não informado'), 500), updated_at = now()
    where id = p_order_id;
  return 'not_concretized';
end;
$$;

revoke all on function public.create_topets_order(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.confirm_topets_order(uuid, numeric) from public, anon, authenticated;
revoke all on function public.mark_topets_order_not_concretized(uuid, text) from public, anon, authenticated;
grant execute on function public.create_topets_order(uuid, jsonb, jsonb) to anon, authenticated;
grant execute on function public.confirm_topets_order(uuid, numeric) to authenticated;
grant execute on function public.mark_topets_order_not_concretized(uuid, text) to authenticated;
