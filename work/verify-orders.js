const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const apiSource = read('outputs/supabase-api.js');
const ordersSql = read('outputs/supabase/orders.sql');
const appSource = read('outputs/app.js');
const adminHtml = read('outputs/admin/index.html');
const adminSource = read('outputs/admin/admin.js');
const salesUtilsSource = read('outputs/admin/sales-utils.js');
const publicKey = 'public-anon-key-for-test';
const sessions = new Map();
const orders = new Map();
const requestKeys = new Map();
const sales = [];
let adminAllowed = false;
let dropFirstCreateResponse = true;
let orderNumber = 0;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function fetchMock(url, options = {}) {
  const parsed = new URL(url), path = parsed.pathname;
  if (path.endsWith('/auth/v1/token')) {
    const body = JSON.parse(options.body);
    return json({ access_token: 'admin-access', refresh_token: 'admin-refresh', expires_in: 3600, user: { id: 'admin-id', email: body.email } });
  }
  if (path.endsWith('/rest/v1/admin_users')) return json(adminAllowed ? [{ user_id: 'admin-id' }] : []);
  if (path.endsWith('/rest/v1/rpc/create_topets_order')) {
    assert.equal(options.headers.Authorization, `Bearer ${publicKey}`, 'public checkout uses only the anon key');
    const body = JSON.parse(options.body), key = body.p_request_id;
    if (requestKeys.has(key)) return json(requestKeys.get(key));
    const id = `order-${++orderNumber}`;
    const row = { id, ...body.p_order, status: 'pending', sale_id: null, order_items: body.p_items };
    orders.set(id, row); requestKeys.set(key, id);
    if (dropFirstCreateResponse) { dropFirstCreateResponse = false; throw new TypeError('network response lost after commit'); }
    return json(id);
  }
  if (path.endsWith('/rest/v1/customer_orders')) {
    assert.equal(options.headers.Authorization, 'Bearer admin-access', 'orders listing requires an authenticated admin session');
    return json([...orders.values()].map(order => ({ ...order, linked_sale: sales.find(sale => sale.id === order.sale_id) || null })));
  }
  if (path.endsWith('/rest/v1/rpc/confirm_topets_order')) {
    assert.equal(options.headers.Authorization, 'Bearer admin-access');
    if (!adminAllowed) return json({ message: 'not authorized' }, 403);
    const { p_order_id: id, p_delivery_fee: fee } = JSON.parse(options.body), order = orders.get(id);
    if (order.status === 'confirmed') return json(order.sale_id);
    assert.equal(order.status, 'pending');
    const sale = { id: `sale-${sales.length + 1}`, order_id: id, status: 'confirmed', total: Number(order.products_subtotal) + Number(fee || 0), sale_items: order.order_items };
    sales.push(sale); order.status = 'confirmed'; order.sale_id = sale.id; order.delivery_fee = fee || 0; order.total = sale.total;
    return json(sale.id);
  }
  if (path.endsWith('/rest/v1/rpc/mark_topets_order_not_concretized')) {
    assert.equal(options.headers.Authorization, 'Bearer admin-access');
    if (!adminAllowed) return json({ message: 'not authorized' }, 403);
    const { p_order_id: id, p_reason: reason } = JSON.parse(options.body), order = orders.get(id);
    assert.equal(order.status, 'pending'); order.status = 'not_concretized'; order.non_concretized_reason = reason;
    return json('not_concretized');
  }
  throw new Error(`Unexpected request ${options.method || 'GET'} ${url}`);
}

const context = {
  window: { TOPETS_SUPABASE_CONFIG: { url: 'https://sample.supabase.co', anonKey: publicKey } },
  sessionStorage: { getItem: key => sessions.get(key) || null, setItem: (key, value) => sessions.set(key, value), removeItem: key => sessions.delete(key) },
  fetch: fetchMock, URLSearchParams, Blob, Response, console
};
vm.runInNewContext(apiSource, context);
const api = context.window.TopetsSupabase;
const utilsContext = { module: { exports: {} }, Intl, Date, Map };
vm.runInNewContext(salesUtilsSource, utilsContext);
const salesUtils = utilsContext.module.exports;

(async () => {
  const idempotency = 'request-key-1';
  const orderPayload = {
    customer_name: 'Cliente Teste', phone: '79999999999', fulfillment: 'delivery', neighborhood: 'Avenida Quirino',
    address: { street: 'Rua Teste', house_number: '10', residence_type: 'Apartamento', apartment_number: '101', block: '2' },
    payment_method: 'Dinheiro', needs_change: true, change_for: 50, products_subtotal: 25, discount: 0,
    delivery_fee: 3, consult_delivery: false, total: 28, notes: 'Sem cebola'
  };
  const orderItems = [{ product_id: 'burger', quantity: 1, base_unit_price: 20, unit_price: 25, extras: [{ name: 'Bacon', price: 5 }], toppings: ['Banana'], item_notes: 'Bem passado' }];

  await assert.rejects(api.listOrders(), /Entre novamente/, 'anonymous client cannot read orders');
  await assert.rejects(api.confirmOrder('order-id', 0), /Entre novamente/, 'anonymous client cannot confirm orders');
  await assert.rejects(api.markOrderNotConcretized('order-id', ''), /Entre novamente/, 'anonymous client cannot change order status');
  await assert.rejects(api.createOrder(idempotency, orderPayload, orderItems), /network response lost/);
  const retriedId = await api.createOrder(idempotency, orderPayload, orderItems);
  assert.equal(retriedId, 'order-1', 'retry returns the original order ID');
  assert.equal(orders.size, 1, 'lost response retry does not create a duplicate order');
  assert.equal(orders.get(retriedId).status, 'pending', 'public RPC creates pending orders only');

  await assert.rejects(api.login('owner@example.test', 'password'), /não está autorizado/);
  adminAllowed = true;
  await api.login('owner@example.test', 'password');
  const pending = await api.listOrders();
  assert.equal(pending[0].id, retriedId, 'authorized admin can read the full order list');
  const firstSaleId = await api.confirmOrder(retriedId, 3);
  const secondSaleId = await api.confirmOrder(retriedId, 3);
  assert.equal(firstSaleId, secondSaleId, 'repeated confirmation returns the existing sale');
  assert.equal(sales.length, 1, 'one order cannot create two sales');

  const secondOrderId = await api.createOrder('request-key-2', orderPayload, orderItems);
  await api.markOrderNotConcretized(secondOrderId, 'Cliente desistiu');
  assert.equal(orders.get(secondOrderId).status, 'not_concretized');
  assert.equal(sales.length, 1, 'non-concretized order does not affect sales');
  assert.equal(salesUtils.summarize(sales).count, 1, 'only the confirmed sale appears in report totals');

  assert.match(ordersSql, /alter table public\.customer_orders enable row level security/i);
  assert.match(ordersSql, /alter table public\.order_items enable row level security/i);
  assert.match(ordersSql, /revoke all on public\.customer_orders, public\.order_items from anon, authenticated/i);
  assert.match(ordersSql, /grant select on public\.customer_orders, public\.order_items to authenticated/i);
  assert.doesNotMatch(ordersSql, /grant select[^;]*to anon/i);
  assert.match(ordersSql, /grant execute on function public\.create_topets_order\(uuid, jsonb, jsonb\) to anon, authenticated/i);
  assert.match(ordersSql, /grant execute on function public\.confirm_topets_order\(uuid, numeric\) to authenticated/i);
  assert.match(ordersSql, /public\.is_topets_admin\(\)/i);
  assert.match(ordersSql, /for update/i);
  assert.match(ordersSql, /on conflict \(client_request_id\) do nothing/i);
  assert.match(ordersSql, /sale_id uuid unique references public\.sales\(id\) on delete restrict/i);
  assert.match(adminHtml, /data-tab="orders"/);
  assert.match(adminHtml, /id="order-details-dialog"/);
  assert.match(adminSource, /api\.confirmOrder\(order\.id, fee\)/);
  const submitStart = appSource.indexOf("$('#checkout').addEventListener('submit'");
  assert.ok(submitStart >= 0);
  const savePosition = appSource.indexOf('TopetsSupabase.createOrder', submitStart);
  const openWhatsAppPosition = appSource.indexOf('waWindow.location.replace(whatsappUrl)', submitStart);
  assert.ok(savePosition > submitStart && openWhatsAppPosition > savePosition, 'WhatsApp navigation happens after order persistence');
  assert.match(appSource, /O WhatsApp não foi aberto/);
  console.log('Order flow mock checks passed: anonymous insert-only RPC, no anonymous reads, idempotent retry, admin-only listing/actions, single sale per order, non-concretized exclusion, and WhatsApp-after-save ordering. Live Supabase/RLS not exercised.');
})().catch(error => { console.error(error); process.exitCode = 1 });
