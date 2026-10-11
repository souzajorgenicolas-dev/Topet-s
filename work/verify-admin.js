const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const apiSource = fs.readFileSync(path.join(root, 'outputs/supabase-api.js'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'outputs/supabase/schema.sql'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'outputs/admin/index.html'), 'utf8');
const siteHtml = fs.readFileSync(path.join(root, 'outputs/index.html'), 'utf8');
const salesSql = fs.readFileSync(path.join(root, 'outputs/supabase/sales.sql'), 'utf8');
const salesUtilsSource = fs.readFileSync(path.join(root, 'outputs/admin/sales-utils.js'), 'utf8');
const products = [{ id: 'burger-1', category: 'Tradicionais', name: 'Burger', price: 10, description: '', image_url: '', active: true, topping_limit: null, sort_order: 0, details: {} }];
let settings = { acaiToppings: ['Banana'], neighborhoods: [], categories: ['Tradicionais'] };
let sales = [];
let permitted = false;
let authorized = false;
const session = new Map();
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const fetchMock = async (url, options = {}) => {
  const pathName = new URL(url).pathname;
  if (pathName.endsWith('/auth/v1/token')) {
    const body = JSON.parse(options.body);
    assert.equal(body.email, 'owner@example.test');
    return json({ access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3600, user: { id: 'admin-uuid', email: body.email } });
  }
  if (pathName.endsWith('/rest/v1/admin_users')) return json(permitted ? [{ user_id: 'admin-uuid' }] : []);
  if (pathName.endsWith('/rest/v1/products')) {
    if (options.method === 'POST') {
      assert.equal(authorized, true, 'product write must use an authenticated session');
      const row = JSON.parse(options.body)[0];
      const index = products.findIndex(item => item.id === row.id);
      if (index < 0) products.push(row); else products[index] = row;
      return json([row]);
    }
    if (options.method === 'DELETE') { assert.equal(authorized, true); products.splice(0, products.length); return new Response(null, { status: 204 }) }
    const activeOnly = new URL(url).searchParams.get('active') === 'eq.true';
    return json(products.filter(item => !activeOnly || item.active));
  }
  if (pathName.endsWith('/rest/v1/store_settings')) {
    if (options.method === 'PATCH') { assert.equal(authorized, true); settings = JSON.parse(options.body).data; return new Response(null, { status: 204 }) }
    return json([{ data: settings }]);
  }
  if (pathName.endsWith('/rest/v1/rpc/record_topets_sale')) {
    assert.equal(authorized, true, 'sale write must use an authenticated session');
    const body = JSON.parse(options.body), sale = body.p_sale;
    const items = body.p_items.map(item => ({ ...item, subtotal: (Number(item.unit_price) + Number(item.extra_unit_price || 0)) * Number(item.quantity) }));
    const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
    const row = { ...sale, id: 'sale-1', products_subtotal: subtotal, total: subtotal - Number(sale.discount) + Number(sale.delivery_fee), status: 'confirmed', sale_items: items };
    sales.push(row); return json(row.id);
  }
  if (pathName.endsWith('/rest/v1/rpc/update_topets_sale')) {
    assert.equal(authorized, true);
    const body = JSON.parse(options.body), row = sales.find(sale => sale.id === body.p_sale_id);
    if (!row || row.status !== 'confirmed') return json({ message: 'Not found' }, 404);
    const items = body.p_items.map(item => ({ ...item, subtotal: (Number(item.unit_price) + Number(item.extra_unit_price || 0)) * Number(item.quantity) }));
    const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
    Object.assign(row, body.p_sale, { products_subtotal: subtotal, total: subtotal - Number(body.p_sale.discount) + Number(body.p_sale.delivery_fee), sale_items: items }); return json(row.id);
  }
  if (pathName.endsWith('/rest/v1/rpc/cancel_topets_sale')) {
    assert.equal(authorized, true); const body = JSON.parse(options.body), row = sales.find(sale => sale.id === body.p_sale_id);
    row.status = 'cancelled'; row.cancel_reason = body.p_reason || ''; return json(null);
  }
  if (pathName.endsWith('/rest/v1/sales')) {
    assert.equal(authorized, true, 'sales history must require admin session');
    const filters = new URL(url).searchParams.get('and');
    assert.match(filters, /sold_at\.gte\.2026-10-01T00:00:00\.000Z/);
    assert.match(filters, /sold_at\.lt\.2026-10-12T00:00:00\.000Z/);
    return json(sales);
  }
  if (pathName.endsWith('/storage/v1/object/product-images/image-uuid.png')) { assert.equal(authorized, true); return json({ Key: 'product-images/image-uuid.png' }) }
  throw new Error(`Unexpected request ${options.method || 'GET'} ${url}`);
};
const context = {
  window: { TOPETS_SUPABASE_CONFIG: { url: 'https://sample.supabase.co', anonKey: 'x'.repeat(40) } },
  sessionStorage: { getItem: key => session.get(key) || null, setItem: (key, value) => session.set(key, value), removeItem: key => session.delete(key) },
  fetch: fetchMock, URLSearchParams, Blob, Response, crypto: { randomUUID: () => 'image-uuid' }, console
};
vm.runInNewContext(apiSource, context);
const api = context.window.TopetsSupabase;
const salesUtilsContext = { module: { exports: {} }, Intl, Date, Map };
vm.runInNewContext(salesUtilsSource, salesUtilsContext);
const salesUtils = salesUtilsContext.module.exports;

(async () => {
  await assert.rejects(api.saveProduct({ id: 'blocked' }), /Entre novamente/);
  await assert.rejects(api.recordSale({}, []), /Entre novamente/, 'sale recording requires an authenticated session');
  await assert.rejects(api.login('owner@example.test', 'password'), /não está autorizado/);
  assert.equal(session.size, 0, 'unauthorized user session should be discarded');
  permitted = true;
  await api.login('owner@example.test', 'password');
  authorized = true;
  const created = { id: 'new-item', category: 'Bebidas', name: 'Água', price: 5, description: '', image_url: '', active: true, topping_limit: null, sort_order: 1, details: {} };
  await api.saveProduct(created);
  assert.equal((await api.listProducts()).some(item => item.id === 'new-item'), true, 'create and read product');
  await api.saveProduct({ ...created, name: 'Água gelada', price: 6 });
  assert.equal(products.find(item => item.id === 'new-item').price, 6, 'edit product');
  const blob = new Blob(['image'], { type: 'image/png' }); Object.defineProperty(blob, 'name', { value: 'test.png' });
  assert.match(await api.uploadImage(blob), /product-images\/image-uuid\.png/, 'upload product image');
  await api.saveSettings({ ...settings, acaiToppings: ['Banana', 'Granola'] });
  const sale = { sold_at: '2026-10-10T14:30:00Z', discount: 2, delivery_fee: 5, payment_method: 'Pix', notes: '' };
  const saleItems = [
    { product_id: 'burger-1', product_name: 'Burger', quantity: 2, unit_price: 10, extra_unit_price: 1, customizations: 'Bacon' },
    { product_id: 'drink-1', product_name: 'Suco', quantity: 1, unit_price: 8, extra_unit_price: 0, customizations: '' }
  ];
  await api.recordSale(sale, saleItems);
  assert.equal(sales[0].products_subtotal, 30, 'sale subtotal includes quantities and per-unit extras');
  assert.equal(sales[0].total, 33, 'sale total applies discount and delivery exactly once');
  assert.equal(salesUtils.totals(saleItems, 2, 5).total, 3300, 'sales calculator handles products, extras, discount and delivery in cents');
  await api.updateSale('sale-1', { ...sale, discount: 0 }, saleItems);
  assert.equal(sales[0].total, 35, 'sale edit recalculates total');
  await api.cancelSale('sale-1', 'Cliente desistiu');
  assert.equal(salesUtils.summarize(sales).count, 0, 'cancelled sale is excluded from report metrics');
  await api.listSales('2026-10-01T00:00:00.000Z', '2026-10-12T00:00:00.000Z');
  const loaded = await api.loadPublicData([], {});
  assert.equal(loaded.menu.length, 2, 'public catalog refresh');
  assert.equal(loaded.menu.find(item => item.id === 'new-item').price, 6, 'public catalog reflects edits');
  assert.deepEqual(Array.from(loaded.config.acaiToppings), ['Banana', 'Granola']);
  await api.saveProduct({ ...created, active: false });
  assert.equal((await api.loadPublicData([], {})).menu.some(item => item.id === 'new-item'), false, 'inactive products stay out of the public menu');
  await api.deleteProduct('new-item');
  assert.equal(products.some(item => item.id === 'new-item'), false, 'delete product');
  api.logout(); authorized = false;
  await assert.rejects(api.saveProduct(created), /Entre novamente/);
  assert.match(schema, /for insert to authenticated with check \(public\.is_topets_admin\(\)\)/);
  assert.match(schema, /public\.is_topets_admin\(\).*\n.*with check/is);
  assert.match(salesSql, /enable row level security/i);
  assert.match(salesSql, /grant execute on function public\.record_topets_sale.*authenticated/is);
  assert.match(salesSql, /security definer/i);
  assert.match(salesSql, /public\.is_topets_admin\(\)/i);
  assert.match(salesSql, /create policy "admins read sales"[\s\S]*using \(public\.is_topets_admin\(\)\)/i);
  assert.match(salesSql, /create policy "admins read sale items"[\s\S]*using \(public\.is_topets_admin\(\)\)/i);
  assert.match(salesSql, /references public\.products\(id\) on delete set null/i);
  assert.match(adminHtml, /type="password"/);
  assert.doesNotMatch(adminHtml, /sign.?up|cadastro livre/i);
  assert.match(siteHtml, /type="module" src="app\.js/);
  console.log('Admin mock checks passed: admin authorization, catalog CRUD/settings, atomic sales RPC calls, edited totals, cancelled-sale exclusion, and public catalog refresh. Live Supabase/RLS not exercised.');
})().catch(error => { console.error(error); process.exitCode = 1 });
