(function () {
  const config = window.TOPETS_SUPABASE_CONFIG || {};
  const base = String(config.url || '').replace(/\/$/, '');
  const anonKey = config.anonKey || '';
  const sessionKey = 'topets-admin-session';
  const configured = () => /^https:\/\//.test(base) && anonKey.length > 20;
  const readSession = () => { try { return JSON.parse(sessionStorage.getItem(sessionKey) || 'null') } catch { return null } };
  const writeSession = session => { if (session) sessionStorage.setItem(sessionKey, JSON.stringify(session)); else sessionStorage.removeItem(sessionKey) };
  async function authRequest(path, body) {
    const response = await fetch(`${base}/auth/v1/${path}`, { method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.msg || data.message || data.error_description || 'Não foi possível autenticar.');
    return data;
  }
  async function refreshSession() {
    const current = readSession();
    if (!current?.refresh_token) throw new Error('Sua sessão expirou. Entre novamente.');
    const data = await authRequest('token?grant_type=refresh_token', { refresh_token: current.refresh_token });
    const session = { ...data, expires_at: Date.now() + Number(data.expires_in || 3600) * 1000 };
    writeSession(session); return session;
  }
  async function accessToken(forceRefresh = false) {
    let session = readSession();
    if (!session?.access_token) throw new Error('Entre novamente no painel.');
    if (forceRefresh || Number(session.expires_at || 0) < Date.now() + 30000) session = await refreshSession();
    return session.access_token;
  }
  async function request(path, options = {}) {
    if (!configured()) throw new Error('Configure o Supabase antes de usar esta função.');
    const useAuth = options.auth !== false;
    const run = async force => {
      const token = useAuth ? await accessToken(force) : anonKey;
      const headers = { apikey: anonKey, Authorization: `Bearer ${token}`, ...(options.headers || {}) };
      if (options.body !== undefined && !(options.body instanceof Blob)) headers['Content-Type'] = 'application/json';
      return fetch(`${base}${path}`, { method: options.method || 'GET', headers, body: options.body instanceof Blob ? options.body : options.body === undefined ? undefined : JSON.stringify(options.body), cache: 'no-store' });
    };
    let response = await run(false);
    if (response.status === 401 && useAuth) response = await run(true);
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('json') ? await response.json().catch(() => null) : await response.text();
    if (!response.ok) throw new Error(data?.message || data?.details || data?.hint || (typeof data === 'string' ? data : null) || `Falha na API (${response.status}).`);
    return data;
  }
  async function login(email, password) {
    if (!configured()) throw new Error('Configure a URL e a chave pública do Supabase antes de entrar.');
    const data = await authRequest('token?grant_type=password', { email, password });
    const session = { ...data, expires_at: Date.now() + Number(data.expires_in || 3600) * 1000 };
    writeSession(session);
    try {
      const admins = await request(`/rest/v1/admin_users?select=user_id&user_id=eq.${encodeURIComponent(data.user.id)}&limit=1`);
      if (!admins?.length) throw new Error('Não autorizado.');
      return session;
    } catch (error) { writeSession(null); throw new Error('Este usuário não está autorizado como administrador.'); }
  }
  function logout() { writeSession(null) }
  async function currentAdmin() {
    const session = readSession();
    if (!session?.user?.id) return null;
    try { const admins = await request(`/rest/v1/admin_users?select=user_id&user_id=eq.${encodeURIComponent(session.user.id)}&limit=1`); if (!admins?.length) throw new Error('Não autorizado.'); return session.user }
    catch { writeSession(null); return null }
  }
  async function listProducts(includeInactive = true) {
    const query = new URLSearchParams({ select: 'id,category,name,price,description,image_url,active,topping_limit,sort_order,details', order: 'sort_order.asc,name.asc' });
    if (!includeInactive) query.set('active', 'eq.true');
    return request(`/rest/v1/products?${query}`, { auth: false });
  }
  async function listSettings() {
    const rows = await request('/rest/v1/store_settings?select=data&id=eq.1&limit=1', { auth: false });
    return rows?.[0]?.data || null;
  }
  async function saveProduct(product) {
    return request('/rest/v1/products?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: [product] });
  }
  async function deleteProduct(id) { return request(`/rest/v1/products?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }); }
  async function updateProductsCategory(from, to) { return request(`/rest/v1/products?category=eq.${encodeURIComponent(from)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { category: to } }); }
  async function saveSettings(data) { return request('/rest/v1/store_settings?id=eq.1', { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { data } }); }
  async function listSales(from, to) {
    const query = new URLSearchParams({ select: '*,sale_items(*)', order: 'sold_at.desc', limit: '1000', sold_at: `gte.${from}` });
    query.set('and', `(sold_at.gte.${from},sold_at.lt.${to})`);
    query.delete('sold_at');
    return request(`/rest/v1/sales?${query}`);
  }
  async function recordSale(sale, items) { return request('/rest/v1/rpc/record_topets_sale', { method: 'POST', body: { p_sale: sale, p_items: items } }); }
  async function updateSale(id, sale, items) { return request('/rest/v1/rpc/update_topets_sale', { method: 'POST', body: { p_sale_id: id, p_sale: sale, p_items: items } }); }
  async function cancelSale(id, reason) { return request('/rest/v1/rpc/cancel_topets_sale', { method: 'POST', body: { p_sale_id: id, p_reason: reason } }); }
  async function createOrder(requestId, order, items) { return request('/rest/v1/rpc/create_topets_order', { method: 'POST', auth: false, body: { p_request_id: requestId, p_order: order, p_items: items } }); }
  async function listOrders() {
    const query = new URLSearchParams({ select: '*,order_items(*),linked_sale:sales(id,status,total)', order: 'created_at.desc', limit: '1000' });
    return request(`/rest/v1/customer_orders?${query}`);
  }
  async function confirmOrder(id, deliveryFee) { return request('/rest/v1/rpc/confirm_topets_order', { method: 'POST', body: { p_order_id: id, p_delivery_fee: deliveryFee } }); }
  async function markOrderNotConcretized(id, reason) { return request('/rest/v1/rpc/mark_topets_order_not_concretized', { method: 'POST', body: { p_order_id: id, p_reason: reason } }); }
  async function uploadImage(file) {
    const extension = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${crypto.randomUUID()}.${extension}`;
    await request(`/storage/v1/object/product-images/${encodeURIComponent(path)}`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false' }, body: file });
    return `${base}/storage/v1/object/public/product-images/${encodeURIComponent(path)}`;
  }
  async function loadPublicData(fallbackMenu, fallbackConfig) {
    if (!configured()) return { menu: fallbackMenu, config: fallbackConfig };
    try {
      const [rows, settings] = await Promise.all([listProducts(false), listSettings()]);
      if (!Array.isArray(rows)) throw new Error('O catálogo do Supabase retornou um formato inesperado.');
      const menu = rows.map(row => ({ ...row.details, id: row.id, category: row.category, name: row.name, price: Number(row.price), description: row.description || '', image_url: row.image_url || '', active: row.active, topping_limit: row.topping_limit }));
      const config = { ...fallbackConfig, ...(settings || {}), addons: menu.filter(product => product.category === 'Adicionais').map(product => ({ name: product.name, price: product.price })) };
      return { menu, config };
    } catch (error) { console.warn('Cardápio remoto indisponível; usando dados locais.', error); return { menu: fallbackMenu, config: fallbackConfig } }
  }
  window.TopetsSupabase = { configured, login, logout, currentAdmin, listProducts, listSettings, saveProduct, deleteProduct, updateProductsCategory, saveSettings, listSales, recordSale, updateSale, cancelSale, createOrder, listOrders, confirmOrder, markOrderNotConcretized, uploadImage, loadPublicData };
})();
