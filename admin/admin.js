const api = window.TopetsSupabase;
const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
let products = [];
let settings = {};
let adminUser = null;
const formatPrice = value => Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const showMessage = (selector, message = '', error = false) => { const element = $(selector); element.textContent = message; element.classList.toggle('error', error) };

function showLogin(message = '') {
  $('#login-view').hidden = false; $('#admin-view').hidden = true;
  showMessage('#login-message', message, !!message);
  $('#setup-note').hidden = api.configured();
}
function showAdmin() {
  $('#login-view').hidden = true; $('#admin-view').hidden = false;
  $('#admin-email').textContent = adminUser.email || '';
}
async function refreshData() {
  showMessage('#products-message', 'Carregando cardápio…');
  try {
    [products, settings] = await Promise.all([api.listProducts(true), api.listSettings()]);
    if (!Array.isArray(products)) products = [];
    settings = settings || {};
    renderProducts(); renderCategories(); fillSettings();
    showMessage('#products-message', `${products.length} produto(s) carregado(s).`);
  } catch (error) { showMessage('#products-message', error.message, true) }
}
function categories() { return [...new Set(settings.categories?.length ? settings.categories : products.map(product => product.category))].filter(Boolean).sort((a,b)=>a.localeCompare(b,'pt-BR')) }
function renderProducts() {
  const term = $('#product-search').value.trim().toLocaleLowerCase('pt-BR');
  const category = $('#category-filter').value;
  const includeInactive = $('#show-inactive').checked;
  const items = products.filter(product => (includeInactive || product.active) && (!category || product.category === category) && `${product.name} ${product.description || ''} ${product.category}`.toLocaleLowerCase('pt-BR').includes(term));
  $('#category-filter').innerHTML = '<option value="">Todas</option>' + categories().map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  $('#category-filter').value = category;
  $('#category-options').innerHTML = categories().map(name => `<option value="${escapeHtml(name)}"></option>`).join('');
  $('#products-list').innerHTML = items.map(product => `<tr><td><div class="product-name">${product.image_url ? `<img src="${escapeHtml(product.image_url)}" alt="">` : ''}<div><b>${escapeHtml(product.name)}</b><small>${escapeHtml(product.id)}</small></div></div></td><td>${escapeHtml(product.category)}</td><td>${formatPrice(product.price)}</td><td><span class="status ${product.active ? 'on' : 'off'}">${product.active ? 'Ativo' : 'Inativo'}</span></td><td><div class="row-actions"><button data-edit="${escapeHtml(product.id)}">Editar</button><button data-toggle="${escapeHtml(product.id)}">${product.active ? 'Desativar' : 'Ativar'}</button><button class="delete" data-delete="${escapeHtml(product.id)}">Excluir</button></div></td></tr>`).join('') || '<tr><td colspan="5">Nenhum produto encontrado.</td></tr>';
}
function renderCategories() {
  const list = categories();
  $('#category-list').innerHTML = list.map(category => `<div class="category-row"><span>${escapeHtml(category)} <small>(${products.filter(item => item.category === category).length} produtos)</small></span><div><button data-rename-category="${escapeHtml(category)}">Renomear</button> <button data-delete-category="${escapeHtml(category)}">Excluir categoria</button></div></div>`).join('') || '<p>Nenhuma categoria cadastrada.</p>';
}
function fillSettings() {
  $('#toppings-setting').value = (settings.acaiToppings || []).join('\n');
  $('#neighborhoods-setting').value = (settings.neighborhoods || []).map(item => `${item.name} | ${item.consultDelivery ? 'consultar' : (Number(item.deliveryFeeCents || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`).join('\n');
}
function openProduct(product = null) {
  const form = $('#product-form'); form.reset();
  form.elements.id.value = product?.id || crypto.randomUUID();
  form.elements.name.value = product?.name || '';
  form.elements.category.value = product?.category || '';
  form.elements.price.value = product?.price ?? '';
  form.elements.description.value = product?.description || '';
  form.elements.image_url.value = product?.image_url || '';
  form.elements.topping_limit.value = product?.topping_limit ?? '';
  form.elements.sort_order.value = product?.sort_order ?? (products.length ? Math.max(...products.map(item => Number(item.sort_order || 0))) + 1 : 0);
  form.elements.active.checked = product?.active ?? true;
  form.elements.details.value = JSON.stringify(product?.details || {}, null, 2);
  $('#dialog-title').textContent = product ? 'Editar produto' : 'Novo produto';
  showMessage('#product-message'); $('#product-dialog').showModal();
}
function parseNeighborhoods(text) {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const separator = line.lastIndexOf('|');
    if (separator < 1) throw new Error(`Use “Bairro | taxa” na linha: ${line}`);
    const name = line.slice(0, separator).trim(), amount = line.slice(separator + 1).trim();
    if (!name) throw new Error('Informe o nome de todos os bairros.');
    if (/^(consultar|a confirmar)$/i.test(amount)) return { name, deliveryFeeCents: null, consultDelivery: true };
    const normalized = amount.replace(/R\$\s*/i, '').replace(/\./g, '').replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw new Error(`Taxa inválida para ${name}.`);
    return { name, deliveryFeeCents: Math.round(Number(normalized) * 100) };
  });
}

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = new FormData(event.currentTarget);
  showMessage('#login-message', 'Entrando…');
  try { await api.login(String(form.get('email')).trim(), String(form.get('password'))); adminUser = await api.currentAdmin(); if (!adminUser) throw new Error('Usuário sem permissão administrativa.'); showAdmin(); await refreshData() }
  catch (error) { showLogin(error.message) }
});
$('#logout-button').addEventListener('click', () => { api.logout(); adminUser = null; showLogin('') });
$('#new-product').addEventListener('click', () => openProduct());
$('#close-dialog').addEventListener('click', () => $('#product-dialog').close());
$('#cancel-product').addEventListener('click', () => $('#product-dialog').close());
$('#reload-products').addEventListener('click', refreshData);
$('#product-search').addEventListener('input', renderProducts);
$('#category-filter').addEventListener('change', renderProducts);
$('#show-inactive').addEventListener('change', renderProducts);
document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(button => button.classList.toggle('active', button === tab));
  for (const panel of ['products', 'categories', 'settings', 'orders', 'sales']) $(`#${panel}-panel`).hidden = tab.dataset.tab !== panel;
  const salesView = tab.dataset.tab === 'sales', ordersView = tab.dataset.tab === 'orders';
  $('#new-product').hidden = salesView || ordersView;
  $('#page-title').textContent = salesView ? 'Relatórios e vendas' : ordersView ? 'Pedidos do site' : 'Gerenciar cardápio';
  $('#page-subtitle').textContent = salesView ? 'Acompanhe somente as vendas confirmadas e registradas pela loja.' : ordersView ? 'Revise os pedidos recebidos e decida se foram concretizados.' : 'As mudanças são salvas no Supabase e aparecem no site público.';
  if (salesView) loadSales().catch(error => showMessage('#sales-message', error.message, true));
  if (ordersView) loadOrders().catch(error => showMessage('#orders-message', error.message, true));
}));
$('#products-list').addEventListener('click', async event => {
  const edit = event.target.closest('[data-edit]'); if (edit) { const product = products.find(item => item.id === edit.dataset.edit); if (product) openProduct(product); return }
  const toggle = event.target.closest('[data-toggle]');
  if (toggle) { const product = products.find(item => item.id === toggle.dataset.toggle); if (!product) return; try { await api.saveProduct({ ...product, active: !product.active }); await refreshData() } catch (error) { showMessage('#products-message', error.message, true) } return }
  const remove = event.target.closest('[data-delete]');
  if (remove) { const product = products.find(item => item.id === remove.dataset.delete); if (!product || !confirm(`Excluir “${product.name}” permanentemente?`)) return; try { await api.deleteProduct(product.id); await refreshData() } catch (error) { showMessage('#products-message', error.message, true) } }
});
$('#product-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget, data = new FormData(form);
  showMessage('#product-message', 'Salvando…');
  try {
    let imageUrl = String(data.get('image_url') || '').trim();
    const file = data.get('image_file');
    if (file?.size) { if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('Use uma imagem JPEG, PNG, WebP ou GIF.'); if (file.size > 5 * 1024 * 1024) throw new Error('A imagem deve ter no máximo 5 MB.'); imageUrl = await api.uploadImage(file) }
    let details; try { details = JSON.parse(String(data.get('details') || '{}')) } catch { throw new Error('O campo de informações extras precisa ser um JSON válido.') }
    if (!details || Array.isArray(details) || typeof details !== 'object') throw new Error('Informações extras precisam ser um objeto JSON.');
    const limit = String(data.get('topping_limit') || '').trim();
    const product = { id: String(data.get('id')), name: String(data.get('name')).trim(), category: String(data.get('category')).trim(), price: Number(data.get('price')), description: String(data.get('description') || '').trim(), image_url: imageUrl, active: form.elements.active.checked, topping_limit: limit === '' ? null : Number(limit), sort_order: Number(data.get('sort_order') || 0), details };
    if (!product.name || !product.category || !Number.isFinite(product.price) || product.price < 0 || (product.topping_limit !== null && (!Number.isInteger(product.topping_limit) || product.topping_limit < 0 || product.topping_limit > 30))) throw new Error('Confira nome, categoria, preço e limite de coberturas.');
    await api.saveProduct(product); $('#product-dialog').close(); await refreshData();
  } catch (error) { showMessage('#product-message', error.message, true) }
});
$('#add-category').addEventListener('click', async () => {
  const name = prompt('Nome da nova categoria:'); if (!name?.trim()) return;
  if (categories().some(category => category.toLocaleLowerCase('pt-BR') === name.trim().toLocaleLowerCase('pt-BR'))) { showMessage('#category-message', 'Essa categoria já existe.', true); return }
  settings.categories = [...categories(), name.trim()].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  try { await api.saveSettings(settings); renderCategories(); showMessage('#category-message', 'Categoria criada.') } catch (error) { showMessage('#category-message', error.message, true) }
});
$('#category-list').addEventListener('click', async event => {
  const rename = event.target.closest('[data-rename-category]');
  if (rename) {
    const oldName = rename.dataset.renameCategory, newName = prompt(`Novo nome para “${oldName}”:`, oldName)?.trim();
    if (!newName || newName === oldName) return;
    if (categories().some(category => category.toLocaleLowerCase('pt-BR') === newName.toLocaleLowerCase('pt-BR'))) { showMessage('#category-message', 'Já existe uma categoria com esse nome.', true); return }
    try { await api.updateProductsCategory(oldName, newName); settings.categories = categories().map(category => category === oldName ? newName : category); await api.saveSettings(settings); await refreshData(); showMessage('#category-message', 'Categoria renomeada.') } catch (error) { showMessage('#category-message', error.message, true) }
    return;
  }
  const remove = event.target.closest('[data-delete-category]'); if (!remove) return;
  const oldName = remove.dataset.deleteCategory, otherCategories = categories().filter(name => name !== oldName);
  if (!otherCategories.length && products.some(item => item.category === oldName)) { showMessage('#category-message', 'Crie outra categoria para mover os produtos antes de excluir esta.', true); return }
  let target = '';
  if (products.some(item => item.category === oldName)) { target = prompt(`Digite a categoria para onde os produtos “${oldName}” serão movidos:\n${otherCategories.join(', ')}`, otherCategories[0])?.trim() || ''; if (!otherCategories.includes(target)) { showMessage('#category-message', 'Escolha uma das categorias existentes para mover os produtos.', true); return } }
  if (!confirm(`Excluir a categoria “${oldName}”${target ? ` e mover seus produtos para “${target}”` : ''}?`)) return;
  try { if (target) await api.updateProductsCategory(oldName, target); settings.categories = categories().filter(name => name !== oldName); await api.saveSettings(settings); await refreshData(); showMessage('#category-message', 'Categoria excluída.') } catch (error) { showMessage('#category-message', error.message, true) }
});
$('#save-settings').addEventListener('click', async () => {
  try {
    settings.acaiToppings = $('#toppings-setting').value.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
    settings.neighborhoods = parseNeighborhoods($('#neighborhoods-setting').value);
    await api.saveSettings(settings); showMessage('#settings-message', 'Configurações salvas no Supabase.');
  } catch (error) { showMessage('#settings-message', error.message, true) }
});

const salesUtils = window.TopetsSalesUtils;
let sales = [];
let orders = [];
const reportMoney = cents => formatPrice(Number(cents || 0) / 100);
const localDateString = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const localDateTimeValue = date => `${localDateString(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
function reportRange() {
  const now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate()), period = $('#sales-period').value;
  let start = today, end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (period === '7d') start.setDate(start.getDate() - 6);
  if (period === '30d') start.setDate(start.getDate() - 29);
  if (period === 'month') start = new Date(today.getFullYear(), today.getMonth(), 1);
  if (period === 'custom') {
    const from = $('#sales-from').value, to = $('#sales-to').value;
    if (!from || !to || from > to) throw new Error('Escolha um intervalo válido para consultar.');
    start = new Date(`${from}T00:00:00`); end = new Date(`${to}T00:00:00`); end.setDate(end.getDate() + 1);
  }
  return { from: start.toISOString(), to: end.toISOString() };
}
async function loadSales() {
  showMessage('#sales-message', 'Carregando vendas registradas…');
  try {
    const range = reportRange();
    sales = await api.listSales(range.from, range.to);
    renderSales();
    showMessage('#sales-message', sales.some(sale => sale.status === 'confirmed') ? `${sales.length} venda(s) no histórico deste período.` : 'Nenhuma venda confirmada registrada neste período. Os indicadores estão zerados.');
  } catch (error) { showMessage('#sales-message', `Não foi possível carregar as vendas: ${error.message}`, true); throw error }
}
function barMarkup(rows, labelField, valueField, formatter, maximum) {
  if (!rows.length) return '<p class="empty-report">Sem vendas registradas neste período.</p>';
  return rows.map(row => `<div class="bar-row"><div class="bar-label"><span>${escapeHtml(row[labelField])}</span><b>${formatter(row[valueField])}</b></div><div class="bar-track"><i style="width:${Math.max(4, Math.round(row[valueField] / maximum * 100))}%"></i></div></div>`).join('');
}
function renderSales() {
  const summary = salesUtils.summarize(sales);
  $('#metric-revenue').textContent = reportMoney(summary.revenue);
  $('#metric-count').textContent = summary.count.toLocaleString('pt-BR');
  $('#metric-average').textContent = reportMoney(summary.average);
  $('#metric-top-product').textContent = summary.topProduct?.name || '—';
  $('#metric-top-quantity').textContent = summary.topProduct ? `${summary.topProduct.quantity} unidade(s)` : '';
  $('#best-products').innerHTML = barMarkup(summary.products.slice(0, 6), 'name', 'quantity', value => `${value} un.`, summary.products[0]?.quantity || 1);
  const dayRows = summary.days.map(day => ({ ...day, label: new Date(`${day.date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) }));
  $('#daily-revenue').innerHTML = dayRows.length ? dayRows.map(day => `<div class="day-row"><span>${escapeHtml(day.label)}</span><div class="bar-track"><i style="width:${Math.max(4, Math.round(day.value / Math.max(...dayRows.map(item => item.value), 1) * 100))}%"></i></div><b>${reportMoney(day.value)}</b></div>`).join('') : '<p class="empty-report">Sem vendas registradas neste período.</p>';
  $('#payment-breakdown').innerHTML = barMarkup(summary.payments, 'name', 'value', reportMoney, summary.payments[0]?.value || 1);
  $('#sales-history').innerHTML = sales.length ? sales.map(sale => {
    const quantity = (sale.sale_items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const status = sale.status === 'confirmed' ? '<span class="status on">Confirmada</span>' : '<span class="status off">Cancelada</span>';
    return `<tr><td>${new Date(sale.sold_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td><td>${quantity} un. <small>${(sale.sale_items || []).length} item(ns)</small></td><td>${escapeHtml(sale.payment_method)}</td><td>${formatPrice(sale.total)}</td><td>${status}</td><td><div class="row-actions"><button data-sale-detail="${escapeHtml(sale.id)}">Ver</button>${sale.status === 'confirmed' ? `<button data-sale-edit="${escapeHtml(sale.id)}">Editar</button><button class="delete" data-sale-cancel="${escapeHtml(sale.id)}">Cancelar</button>` : ''}</div></td></tr>`;
  }).join('') : '<tr><td colspan="6">Nenhuma venda registrada neste período.</td></tr>';
}
function orderLinkedSale(order) { return Array.isArray(order.linked_sale) ? order.linked_sale[0] : order.linked_sale }
function orderStatusLabel(order) {
  if (order.status === 'pending') return '<span class="status pending">Pendente</span>';
  if (order.status === 'not_concretized') return '<span class="status off">Não concretizado</span>';
  return orderLinkedSale(order)?.status === 'cancelled' ? '<span class="status off">Venda cancelada</span>' : '<span class="status on">Venda confirmada</span>';
}
function renderOrders() {
  const visible = $('#orders-filter').value === 'pending' ? orders.filter(order => order.status === 'pending') : orders;
  $('#orders-list').innerHTML = visible.length ? visible.map(order => {
    const quantity = (order.order_items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const total = order.total === null ? 'A confirmar' : formatPrice(order.total);
    const actions = order.status === 'pending' ? `<button data-order-view="${escapeHtml(order.id)}">Detalhes</button><button data-order-confirm="${escapeHtml(order.id)}">Confirmar venda</button><button class="delete" data-order-no-sale="${escapeHtml(order.id)}">Não concretizado</button>` : `<button data-order-view="${escapeHtml(order.id)}">Detalhes</button>`;
    return `<tr><td><b>#${escapeHtml(order.id.slice(0, 8).toUpperCase())}</b><small>${new Date(order.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</small></td><td>${escapeHtml(order.customer_name)}<small>${escapeHtml(order.phone)}</small></td><td>${quantity} un. <small>${(order.order_items || []).length} produto(s)</small></td><td>${escapeHtml(order.payment_method)}${order.needs_change ? `<small>Troco para ${formatPrice(order.change_for)}</small>` : ''}</td><td>${total}</td><td>${orderStatusLabel(order)}</td><td><div class="row-actions order-actions">${actions}</div></td></tr>`;
  }).join('') : `<tr><td colspan="7">${$('#orders-filter').value === 'pending' ? 'Nenhum pedido pendente.' : 'Nenhum pedido recebido pelo site.'}</td></tr>`;
}
async function loadOrders() {
  showMessage('#orders-message', 'Carregando pedidos do site…');
  try { orders = await api.listOrders(); renderOrders(); showMessage('#orders-message', `${orders.filter(order => order.status === 'pending').length} pedido(s) aguardando análise.`) }
  catch (error) { showMessage('#orders-message', `Não foi possível carregar os pedidos. Confira se a migração supabase/orders.sql foi aplicada. ${error.message}`, true); throw error }
}
function orderAddressText(address) {
  if (!address) return 'Retirada no local';
  const lines = [`${address.street || ''}, ${address.house_number || ''}`.trim()];
  if (address.residence_type === 'Apartamento') lines.push(`Apartamento ${address.apartment_number || ''} bloco ${address.block || ''}`);
  else if (address.residence_type) lines.push(`Residência: ${address.residence_type}`);
  if (address.complement) lines.push(`Complemento: ${address.complement}`);
  if (address.reference) lines.push(`Referência: ${address.reference}`);
  return lines.join(' | ');
}
function showOrderDetails(order) {
  const items = (order.order_items || []).map(item => {
    const details = [];
    if (item.extras?.length) details.push(`Adicionais: ${item.extras.map(extra => `${extra.name} (+${formatPrice(extra.price)})`).join(', ')}`);
    if (item.toppings?.length) details.push(`Acompanhamentos: ${item.toppings.join(', ')}`);
    if (item.item_notes) details.push(`Obs.: ${item.item_notes}`);
    return `<li><div><b>${Number(item.quantity)}× ${escapeHtml(item.product_name)}</b><small>${escapeHtml(details.join(' · ') || item.category)}<br>${formatPrice(item.unit_price)} / unidade</small></div><strong>${formatPrice(item.subtotal)}</strong></li>`;
  }).join('');
  const linkedSale = orderLinkedSale(order);
  const actions = order.status === 'pending' ? `<div class="order-detail-actions"><button class="primary" data-order-confirm="${escapeHtml(order.id)}">Confirmar venda</button><button class="quiet" data-order-no-sale="${escapeHtml(order.id)}">Marcar não concretizado</button></div>` : '';
  $('#order-details-content').innerHTML = `<div class="dialog-heading"><div><p class="eyebrow">PEDIDO DO SITE · ${escapeHtml(order.id)}</p><h2>${orderStatusLabel(order).replace(/<[^>]+>/g, '')}</h2></div><button type="button" class="icon-button" id="close-order-details" aria-label="Fechar">×</button></div><p class="detail-date">${new Date(order.created_at).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' })}</p><div class="order-customer"><b>${escapeHtml(order.customer_name)}</b><span>${escapeHtml(order.phone)}</span></div><ul class="sale-detail-items">${items}</ul><div class="order-delivery-details"><b>${order.fulfillment === 'delivery' ? 'Entrega' : 'Retirada no local'}</b><span>${order.neighborhood ? `Bairro: ${escapeHtml(order.neighborhood)}<br>` : ''}${escapeHtml(orderAddressText(order.address))}</span></div><div class="order-delivery-details"><b>Pagamento</b><span>${escapeHtml(order.payment_method)}${order.needs_change ? `<br>Troco para: ${formatPrice(order.change_for)}` : ''}</span></div><div class="sale-total-box"><div><span>Subtotal dos produtos</span><b>${formatPrice(order.products_subtotal)}</b></div><div><span>Desconto</span><b>− ${formatPrice(order.discount)}</b></div><div><span>Entrega</span><b>${order.delivery_fee === null ? 'A confirmar com a loja' : formatPrice(order.delivery_fee)}</b></div><div class="grand-total"><span>Total</span><b>${order.total === null ? 'A confirmar com a loja' : formatPrice(order.total)}</b></div></div>${order.notes ? `<p><b>Observações:</b> ${escapeHtml(order.notes)}</p>` : ''}${order.status === 'not_concretized' ? `<p class="cancel-note"><b>Não concretizado:</b> ${escapeHtml(order.non_concretized_reason || 'Motivo não informado')}</p>` : ''}${linkedSale ? `<p class="linked-sale-note">Venda vinculada: ${escapeHtml(linkedSale.id)} · ${linkedSale.status === 'cancelled' ? 'cancelada nos relatórios' : 'confirmada'}</p>` : ''}${actions}`;
  $('#order-details-dialog').showModal();
}
async function confirmOrderFromAdmin(order) {
  if (!order || order.status !== 'pending') return;
  let fee = order.fulfillment === 'pickup' ? 0 : Number(order.delivery_fee);
  if (order.fulfillment === 'delivery' && order.delivery_fee === null) {
    const entered = prompt('A entrega está marcada para consulta. Informe a taxa combinada com o cliente (R$):', '');
    if (entered === null) return;
    const parsed = parseMoneyCents(entered);
    if (parsed === null) { showMessage('#orders-message', 'Informe uma taxa válida, como 5,00.', true); return }
    fee = parsed / 100;
  }
  const estimatedTotal = Number(order.products_subtotal) - Number(order.discount) + fee;
  const summary = `Confirmar este pedido como venda?\n\nPedido #${order.id.slice(0, 8).toUpperCase()} · ${order.customer_name}\n${(order.order_items || []).map(item => `${item.quantity}× ${item.product_name}`).join('\n')}\n\nProdutos: ${formatPrice(order.products_subtotal)}\nDesconto: ${formatPrice(order.discount)}\nEntrega: ${formatPrice(fee)}\nTotal da venda: ${formatPrice(estimatedTotal)}\nPagamento: ${order.payment_method}`;
  if (!confirm(summary)) return;
  try {
    const saleId = await api.confirmOrder(order.id, fee);
    $('#order-details-dialog').close();
    try { await Promise.all([loadOrders(), loadSales()]); showMessage('#orders-message', `Pedido vinculado à venda ${String(saleId).slice(0, 8).toUpperCase()}. Os relatórios foram atualizados.`) }
    catch (refreshError) { showMessage('#orders-message', `Venda confirmada e vinculada (${String(saleId).slice(0, 8).toUpperCase()}); não foi possível atualizar a lista: ${refreshError.message}`, true) }
  } catch (error) { showMessage('#orders-message', `Não foi possível confirmar este pedido: ${error.message}`, true) }
}
async function markOrderNotConcretized(order) {
  if (!order || order.status !== 'pending') return;
  if (!confirm(`Marcar o pedido #${order.id.slice(0, 8).toUpperCase()} como não concretizado? Ele permanecerá no histórico sem entrar no faturamento.`)) return;
  const reason = prompt('Motivo (opcional):');
  if (reason === null) return;
  try {
    await api.markOrderNotConcretized(order.id, reason);
    $('#order-details-dialog').close();
    try { await loadOrders(); showMessage('#orders-message', 'Pedido marcado como não concretizado e mantido no histórico.') }
    catch (refreshError) { showMessage('#orders-message', `Pedido atualizado; falha ao atualizar a lista: ${refreshError.message}`, true) }
  } catch (error) { showMessage('#orders-message', `Não foi possível atualizar o pedido: ${error.message}`, true) }
}
function fillPaymentOptions(selected = '') {
  const methods = [...new Set([...(settings.paymentMethods || window.config?.paymentMethods || ['Pix', 'Dinheiro', 'Cartão de crédito', 'Cartão de débito']), selected].filter(Boolean))];
  $('#sale-payment').innerHTML = methods.map(method => `<option value="${escapeHtml(method)}">${escapeHtml(method)}</option>`).join('');
  if (selected) $('#sale-payment').value = selected;
}
function addSaleItem(item = {}) {
  const row = document.createElement('div'); row.className = 'sale-item-row';
  const options = products.map(product => `<option value="${escapeHtml(product.id)}" data-name="${escapeHtml(product.name)}" data-price="${Number(product.price)}">${escapeHtml(product.name)}${product.active ? '' : ' (inativo)'}</option>`).join('');
  const orphan = item.product_id && !products.some(product => product.id === item.product_id) ? `<option value="${escapeHtml(item.product_id)}" data-name="${escapeHtml(item.product_name)}" data-price="${Number(item.unit_price)}">${escapeHtml(item.product_name)} (fora do cardápio atual)</option>` : '';
  row.innerHTML = `<label class="sale-product-field">Produto<select class="sale-product" required><option value="">Selecione</option>${orphan}${options}</select></label><label>Qtd.<input class="sale-quantity" type="number" min="1" step="1" value="${Number(item.quantity || 1)}" required></label><label>Preço unitário<input class="sale-unit-price" type="number" min="0" step="0.01" value="${item.unit_price ?? ''}" required></label><label>Adicionais (R$/un.)<input class="sale-extra-price" type="number" min="0" step="0.01" value="${item.extra_unit_price ?? 0}" required></label><label class="sale-custom-field">Personalizações / adicionais<textarea class="sale-customizations" rows="2" placeholder="Ex.: açaí 500 ml, banana e granola">${escapeHtml(item.customizations || '')}</textarea></label><button type="button" class="remove-sale-item" aria-label="Remover produto">×</button>`;
  $('#sale-items').append(row);
  const select = row.querySelector('.sale-product');
  if (item.product_id) select.value = item.product_id;
  if (!item.unit_price && select.value) row.querySelector('.sale-unit-price').value = select.selectedOptions[0]?.dataset.price || '';
  return row;
}
function saleFormItems() {
  return [...document.querySelectorAll('.sale-item-row')].map(row => {
    const option = row.querySelector('.sale-product').selectedOptions[0];
    return { product_id: row.querySelector('.sale-product').value, product_name: option?.dataset.name || '', quantity: Number(row.querySelector('.sale-quantity').value), unit_price: Number(row.querySelector('.sale-unit-price').value), extra_unit_price: Number(row.querySelector('.sale-extra-price').value), customizations: row.querySelector('.sale-customizations').value.trim() };
  });
}
function updateSaleTotal() {
  try {
    const totals = salesUtils.totals(saleFormItems(), $('#sale-form').elements.discount.value || 0, $('#sale-form').elements.delivery_fee.value || 0);
    $('#sale-subtotal').textContent = reportMoney(totals.subtotal); $('#sale-discount-view').textContent = `− ${reportMoney(totals.discount)}`;
    $('#sale-delivery-view').textContent = reportMoney(totals.delivery); $('#sale-total').textContent = reportMoney(totals.total);
    showMessage('#sale-form-message');
  } catch (error) { showMessage('#sale-form-message', error.message, true) }
}
function openSale(sale = null) {
  const form = $('#sale-form'); form.reset(); $('#sale-items').replaceChildren();
  form.elements.sale_id.value = sale?.id || ''; form.elements.sold_at.value = localDateTimeValue(sale ? new Date(sale.sold_at) : new Date());
  form.elements.discount.value = sale?.discount ?? 0; form.elements.delivery_fee.value = sale?.delivery_fee ?? 0; form.elements.notes.value = sale?.notes || '';
  fillPaymentOptions(sale?.payment_method || '');
  if (sale?.sale_items?.length) sale.sale_items.forEach(item => addSaleItem(item)); else addSaleItem();
  $('#sale-dialog-title').textContent = sale ? 'Editar venda registrada' : 'Registrar venda';
  showMessage('#sale-form-message'); updateSaleTotal(); $('#sale-dialog').showModal();
}
function showSaleDetails(sale) {
  const lines = (sale.sale_items || []).map(item => `<li><div><b>${Number(item.quantity)}× ${escapeHtml(item.product_name)}</b><small>${formatPrice(item.unit_price)}${Number(item.extra_unit_price) ? ` + ${formatPrice(item.extra_unit_price)} em adicionais/un.` : ''}${item.customizations ? `<br>${escapeHtml(item.customizations)}` : ''}</small></div><strong>${formatPrice(item.subtotal)}</strong></li>`).join('');
  $('#sale-details-content').innerHTML = `<div class="dialog-heading"><div><p class="eyebrow">DETALHES DA VENDA</p><h2>${sale.status === 'confirmed' ? 'Venda confirmada' : 'Venda cancelada'}</h2></div><button type="button" class="icon-button" id="close-sale-details" aria-label="Fechar">×</button></div><p class="detail-date">${new Date(sale.sold_at).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' })} · ${escapeHtml(sale.payment_method)}</p><ul class="sale-detail-items">${lines}</ul><div class="sale-total-box"><div><span>Produtos</span><b>${formatPrice(sale.products_subtotal)}</b></div><div><span>Desconto</span><b>− ${formatPrice(sale.discount)}</b></div><div><span>Entrega</span><b>${formatPrice(sale.delivery_fee)}</b></div><div class="grand-total"><span>Total</span><b>${formatPrice(sale.total)}</b></div></div>${sale.notes ? `<p><b>Observações:</b> ${escapeHtml(sale.notes)}</p>` : ''}${sale.status === 'cancelled' ? `<p class="cancel-note"><b>Cancelada:</b> ${escapeHtml(sale.cancel_reason || 'Motivo não informado')} · ${sale.cancelled_at ? new Date(sale.cancelled_at).toLocaleString('pt-BR') : ''}</p>` : ''}`;
  $('#sale-details-dialog').showModal();
}
$('#sales-period').addEventListener('change', () => {
  const custom = $('#sales-period').value === 'custom'; document.querySelectorAll('.date-filter').forEach(field => { field.hidden = !custom });
  if (custom) { const today = localDateString(new Date()); $('#sales-from').value ||= today; $('#sales-to').value ||= today }
  loadSales().catch(() => {});
});
$('#orders-filter').addEventListener('change', renderOrders);
$('#reload-orders').addEventListener('click', () => loadOrders().catch(() => {}));
$('#orders-list').addEventListener('click', event => {
  const view = event.target.closest('[data-order-view]');
  if (view) { const order = orders.find(item => item.id === view.dataset.orderView); if (order) showOrderDetails(order); return }
  const confirmButton = event.target.closest('[data-order-confirm]');
  if (confirmButton) { confirmOrderFromAdmin(orders.find(item => item.id === confirmButton.dataset.orderConfirm)); return }
  const noSale = event.target.closest('[data-order-no-sale]');
  if (noSale) markOrderNotConcretized(orders.find(item => item.id === noSale.dataset.orderNoSale));
});
$('#order-details-content').addEventListener('click', event => {
  if (event.target.closest('#close-order-details')) { $('#order-details-dialog').close(); return }
  const confirmButton = event.target.closest('[data-order-confirm]');
  if (confirmButton) { confirmOrderFromAdmin(orders.find(item => item.id === confirmButton.dataset.orderConfirm)); return }
  const noSale = event.target.closest('[data-order-no-sale]');
  if (noSale) markOrderNotConcretized(orders.find(item => item.id === noSale.dataset.orderNoSale));
});
$('#sales-from').addEventListener('change', () => loadSales().catch(() => {}));
$('#sales-to').addEventListener('change', () => loadSales().catch(() => {}));
$('#reload-sales').addEventListener('click', () => loadSales().catch(() => {}));
$('#new-sale').addEventListener('click', () => openSale());
$('#add-sale-item').addEventListener('click', () => { addSaleItem(); updateSaleTotal() });
$('#sale-items').addEventListener('change', event => {
  if (event.target.matches('.sale-product')) { const row = event.target.closest('.sale-item-row'); row.querySelector('.sale-unit-price').value = event.target.selectedOptions[0]?.dataset.price || ''; updateSaleTotal() }
});
$('#sale-items').addEventListener('input', updateSaleTotal);
$('#sale-items').addEventListener('click', event => { if (event.target.closest('.remove-sale-item')) { event.target.closest('.sale-item-row').remove(); updateSaleTotal() } });
$('#sale-form').elements.discount.addEventListener('input', updateSaleTotal);
$('#sale-form').elements.delivery_fee.addEventListener('input', updateSaleTotal);
$('#close-sale-dialog').addEventListener('click', () => $('#sale-dialog').close());
$('#cancel-sale-form').addEventListener('click', () => $('#sale-dialog').close());
$('#sale-details-content').addEventListener('click', event => { if (event.target.closest('#close-sale-details')) $('#sale-details-dialog').close() });
$('#sale-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget, items = saleFormItems(), soldAt = form.elements.sold_at.value;
  try {
    const totals = salesUtils.totals(items, form.elements.discount.value || 0, form.elements.delivery_fee.value || 0);
    if (!items.length || items.some(item => !item.product_name || !Number.isInteger(item.quantity) || item.quantity < 1)) throw new Error('Inclua produtos válidos e quantidades inteiras.');
    if (!soldAt || !form.elements.payment_method.value) throw new Error('Informe a data e a forma de pagamento.');
    const summary = `Confira a venda:\n\n${items.map(item => `${item.quantity}× ${item.product_name}: ${formatPrice((item.unit_price + item.extra_unit_price) * item.quantity)}`).join('\n')}\n\nProdutos: ${reportMoney(totals.subtotal)}\nDesconto: ${reportMoney(totals.discount)}\nEntrega: ${reportMoney(totals.delivery)}\nTotal: ${reportMoney(totals.total)}\nPagamento: ${form.elements.payment_method.value}\n\nSalvar esta venda?`;
    if (!confirm(summary)) return;
    const sale = { sold_at: new Date(soldAt).toISOString(), discount: totals.discount / 100, delivery_fee: totals.delivery / 100, payment_method: form.elements.payment_method.value, notes: form.elements.notes.value.trim() };
    showMessage('#sale-form-message', 'Salvando venda…');
    const id = form.elements.sale_id.value;
    if (id) await api.updateSale(id, sale, items); else await api.recordSale(sale, items);
    $('#sale-dialog').close();
    const savedMessage = id ? 'Venda atualizada com sucesso.' : 'Venda registrada com sucesso.';
    try { await loadSales(); showMessage('#sales-message', savedMessage) }
    catch (error) { showMessage('#sales-message', `${savedMessage} Não foi possível atualizar os relatórios: ${error.message}`, true) }
  } catch (error) { showMessage('#sale-form-message', `A venda não foi salva: ${error.message}`, true) }
});
$('#sales-history').addEventListener('click', async event => {
  const detail = event.target.closest('[data-sale-detail]');
  if (detail) { const sale = sales.find(item => item.id === detail.dataset.saleDetail); if (sale) showSaleDetails(sale); return }
  const edit = event.target.closest('[data-sale-edit]');
  if (edit) { const sale = sales.find(item => item.id === edit.dataset.saleEdit); if (sale?.status === 'confirmed') openSale(sale); return }
  const cancel = event.target.closest('[data-sale-cancel]');
  if (cancel) {
    const sale = sales.find(item => item.id === cancel.dataset.saleCancel); if (!sale || !confirm(`Cancelar a venda de ${formatPrice(sale.total)}? O registro permanecerá no histórico e sairá dos indicadores.`)) return;
    const reason = prompt('Motivo do cancelamento (opcional):') || '';
    try {
      await api.cancelSale(sale.id, reason);
      try { await loadSales(); showMessage('#sales-message', 'Venda cancelada e mantida no histórico.') }
      catch (error) { showMessage('#sales-message', `Cancelamento salvo; falha ao atualizar o histórico: ${error.message}`, true) }
    }
    catch (error) { showMessage('#sales-message', `Não foi possível cancelar a venda: ${error.message}`, true) }
  }
});

if (!api.configured()) showLogin('Configure uma URL e a chave pública do Supabase.');
else api.currentAdmin().then(user => { if (!user) showLogin(''); else { adminUser = user; showAdmin(); refreshData() } });
