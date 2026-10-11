const { menu, config } = await window.loadTopetsData();
window.menu = menu;
window.config = config;
const $ = selector => document.querySelector(selector);
const money = value => Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const toCents = value => Math.round(Number(value) * 100);
const moneyCents = cents => money(cents / 100);
const cartKey = 'topets-cart-v1';
try { localStorage.removeItem(cartKey) } catch { }
const cart = [];
let checkoutInProgress = false;
const orderRequestStorageKey = 'topets-order-request-v1';
let pendingOrderRequest = (() => { try { return JSON.parse(sessionStorage.getItem(orderRequestStorageKey) || 'null') } catch { return null } })();
function newOrderRequestId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return [...bytes].map((byte, index) => `${[4, 6, 8, 10].includes(index) ? '-' : ''}${byte.toString(16).padStart(2, '0')}`).join('');
}
async function fingerprintOrder(payload) {
  const source = new TextEncoder().encode(JSON.stringify(payload));
  if (crypto.subtle?.digest) {
    const digest = await crypto.subtle.digest('SHA-256', source);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  let hash = 2166136261;
  for (const byte of source) hash = Math.imul(hash ^ byte, 16777619);
  return (hash >>> 0).toString(16);
}
let activeCategory = 'Todos';
let selectedProduct = null;
const categories = ['Todos', ...new Set(config.categories?.length ? config.categories : menu.map(product => product.category))];
const addonCategories = new Set(['Destaques da casa', 'Tradicionais', 'Cachorro-quente', 'Frango', 'Filé de frango', 'Calabresa e bacon', 'Filé', 'Coração', 'Picanha e especiais', 'Tapiocas', 'Espetinhos']);

$('#categories').innerHTML = categories.map((category, index) => `<button class="category ${index === 0 ? 'active' : ''}" data-category="${esc(category)}">${esc(category)}</button>`).join('');
function esc(value = '') { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])) }
function renderMenu() {
  const term = $('#search').value.trim().toLocaleLowerCase('pt-BR');
  const filtered = menu.filter(product => (activeCategory === 'Todos' || product.category === activeCategory) && (`${product.name} ${product.description || ''} ${product.category}`).toLocaleLowerCase('pt-BR').includes(term));
  $('#menu-grid').innerHTML = filtered.map(product => `<article class="product-card">${product.image_url ? `<img class="product-image" src="${esc(product.image_url)}" alt="${esc(product.name)}" loading="lazy">` : ''}<div class="card-top"><div><h3>${esc(product.name)}</h3><span class="custom-tag">${esc(product.category)}${product.category === 'Açaí' ? ' · personalize' : ''}</span></div><b class="price">${money(product.price)}</b></div><p>${esc(product.description || 'Preparado na hora. Consulte nossa equipe pelo WhatsApp para detalhes.')}</p><div class="card-bottom"><button class="add-button" data-add="${esc(product.id)}">+ Adicionar</button><span class="custom-tag">${product.category === 'Açaí' || addonCategories.has(product.category) ? 'Personalize seu lanche' : 'Topet’s Lanches'}</span></div></article>`).join('');
  $('#no-results').hidden = filtered.length > 0;
}
function renderNeighborhoods() {
  const select = $('#district');
  if (!Array.isArray(config.neighborhoods) || config.neighborhoods.length === 0) { select.innerHTML = '<option value="">Bairros ainda não configurados</option>'; select.disabled = true; $('#neighborhood-help').textContent = 'A hamburgueria precisa cadastrar os bairros atendidos e suas taxas em data.js.'; return }
  select.innerHTML = '<option value="">Selecione seu bairro</option>' + config.neighborhoods.map(item => `<option value="${esc(item.name)}">${esc(item.name)}</option>`).join('');
  select.disabled = false; $('#neighborhood-help').textContent = 'A taxa de entrega será calculada para o bairro selecionado.';
}
$('#categories').addEventListener('click', event => { const button = event.target.closest('[data-category]'); if (!button) return; activeCategory = button.dataset.category; document.querySelectorAll('.category').forEach(item => item.classList.toggle('active', item === button)); renderMenu() });
$('#search').addEventListener('input', renderMenu);
function acaiLimit(product) { return Number.isInteger(product.topping_limit) ? product.topping_limit : product.name.toLowerCase().includes('barca') ? 7 : product.name.toLowerCase().includes('1 litro') ? 5 : 3 }
function updateAcaiCount() { const count = $('#modal-toppings').querySelectorAll('[data-topping]:checked').length; const limit = acaiLimit(selectedProduct); $('#topping-count').textContent = `${count} selecionado${count === 1 ? '' : 's'} · ${limit - count} restante${limit - count === 1 ? '' : 's'}` }
function updateModalPrice() { if (!selectedProduct) return; const extraTotal = [...$('#modal-toppings').querySelectorAll('[data-addon]:checked')].reduce((sum, input) => sum + Number(input.dataset.priceCents), 0); $('#modal-price').textContent = moneyCents(toCents(selectedProduct.price) + extraTotal) }
function openModal(product) {
  selectedProduct = product; $('#modal-category').textContent = product.category; $('#modal-title').textContent = product.name; $('#modal-description').textContent = product.description || 'Preparado na hora.'; $('#item-notes').value = '';
  let options = '';
  if (product.category === 'Açaí') {
    const limit = acaiLimit(product);
    options += `<div class="option-title">Acompanhamentos <span id="topping-count">0 selecionados · ${limit} restantes</span></div><p class="option-note">Calda grátis. Escolha seus acompanhamentos favoritos.</p><div class="topping-grid">${config.acaiToppings.map(topping => `<label class="topping-choice"><input type="checkbox" data-topping value="${esc(topping)}">${esc(topping)}</label>`).join('')}</div>`;
  }
  if (addonCategories.has(product.category)) options += `<div class="option-title addon-title">Adicionais <span>escolha individualmente</span></div><div class="topping-grid addon-grid">${config.addons.map(addon => `<label class="topping-choice addon-choice"><input type="checkbox" data-addon value="${esc(addon.name)}" data-price-cents="${toCents(addon.price)}"><span>${esc(addon.name)}</span><b>+ ${money(addon.price)}</b></label>`).join('')}</div>`;
  $('#modal-toppings').innerHTML = options;
  $('#modal-toppings').querySelectorAll('input').forEach(input => input.addEventListener('change', () => { if (input.hasAttribute('data-topping')) { const limit = acaiLimit(product); if ($('#modal-toppings').querySelectorAll('[data-topping]:checked').length > limit) input.checked = false; updateAcaiCount() } updateModalPrice() }));
  updateModalPrice(); $('#product-modal').hidden = false; document.body.style.overflow = 'hidden';
}
$('#menu-grid').addEventListener('click', event => { const button = event.target.closest('[data-add]'); if (!button) return; const product = menu.find(item => item.id === button.dataset.add); if (!product) return; if (product.category === 'Açaí' || addonCategories.has(product.category)) openModal(product); else addItem(product, [], '', []) });
function addItem(product, toppings = [], notes = '', extras = []) {
  if (checkoutInProgress) return false;
  if (product.category === 'Açaí' && toppings.length > acaiLimit(product)) { alert(`Este açaí permite até ${acaiLimit(product)} acompanhamentos.`); return false }
  const basePriceCents = toCents(product.price), extrasTotal = extras.reduce((sum, extra) => sum + extra.priceCents, 0), priceCents = basePriceCents + extrasTotal;
  const signature = JSON.stringify([product.id, toppings, notes, extras]); const found = cart.find(item => item.signature === signature);
  if (found) found.qty++; else cart.push({ signature, id: product.id, name: product.name, category: product.category, basePriceCents, priceCents, qty: 1, toppings, extras, notes });
  save(); renderCart(); toast('Adicionado à sacola'); return true;
}
$('#confirm-add').onclick = () => {
  const toppings = [...$('#modal-toppings').querySelectorAll('[data-topping]:checked')].map(input => input.value);
  const extras = [...$('#modal-toppings').querySelectorAll('[data-addon]:checked')].map(input => ({ name: input.value, priceCents: Number(input.dataset.priceCents) }));
  if (selectedProduct.category === 'Açaí' && toppings.length > acaiLimit(selectedProduct)) { alert(`Este açaí permite até ${acaiLimit(selectedProduct)} acompanhamentos.`); return }
  if (addItem(selectedProduct, toppings, $('#item-notes').value.trim(), extras)) { $('#product-modal').hidden = true; document.body.style.overflow = '' }
};
$('#close-modal').onclick = () => { $('#product-modal').hidden = true; document.body.style.overflow = '' };
$('#product-modal').addEventListener('click', event => { if (event.target === $('#product-modal')) { $('#product-modal').hidden = true; document.body.style.overflow = '' } });
function save() { $('#cart-count').textContent = cart.reduce((sum, item) => sum + item.qty, 0); $('#drawer-count').textContent = `(${cart.reduce((sum, item) => sum + item.qty, 0)})` }
function selectedNeighborhood() { return config.neighborhoods.find(item => item.name === $('#district').value) || null }
function deliveryFeeCents() { const neighborhood = selectedNeighborhood(); return neighborhood && Number.isSafeInteger(neighborhood.deliveryFeeCents) && neighborhood.deliveryFeeCents >= 0 ? neighborhood.deliveryFeeCents : null }
function isConsultDelivery() { const neighborhood = selectedNeighborhood(); return !!(neighborhood && neighborhood.consultDelivery) }
function renderCart() {
  save();
  $('#cart-items').innerHTML = cart.map((item, index) => `<article class="cart-item"><div class="cart-item-head"><div><h3>${esc(item.name)}</h3>${item.extras.length ? `<p>Adicionais: ${item.extras.map(extra => `${esc(extra.name)} (+${moneyCents(extra.priceCents)})`).join(', ')}</p>` : ''}${item.toppings.length ? `<p>Acompanhamentos: ${item.toppings.map(esc).join(', ')}</p>` : ''}${item.notes ? `<p>Obs.: ${esc(item.notes)}</p>` : ''}</div><b class="cart-item-price">${moneyCents(item.priceCents * item.qty)}</b></div><div class="qty-row"><div class="qty-control"><button data-qty="${index}" data-delta="-1" aria-label="Diminuir">−</button><span>${item.qty}</span><button data-qty="${index}" data-delta="1" aria-label="Aumentar">+</button></div><small>${moneyCents(item.priceCents)} / un.</small><button class="remove-item" data-remove="${index}">Remover</button></div></article>`).join('');
  const empty = cart.length === 0; $('#empty-cart').hidden = !empty; $('#totals').hidden = empty; $('#checkout').hidden = empty; $('#clear-cart').hidden = empty;
  const subtotal = cart.reduce((sum, item) => sum + item.priceCents * item.qty, 0), delivery = document.querySelector('[name=fulfillment]:checked').value === 'delivery', fee = delivery ? deliveryFeeCents() : 0;
  const consult = delivery && isConsultDelivery();
  $('#subtotal').textContent = moneyCents(subtotal); $('#delivery-line').hidden = empty || !delivery; $('#delivery-value').textContent = !delivery ? '' : consult ? 'A confirmar no WhatsApp' : fee === null ? 'Taxa a configurar' : moneyCents(fee); $('#total').textContent = delivery && fee === null ? (consult ? 'Produtos + entrega a confirmar' : 'A configurar') : moneyCents(subtotal + fee);
}
$('#cart-items').addEventListener('click', event => { if (checkoutInProgress) return; let button = event.target.closest('[data-qty]'); if (button) { const index = Number(button.dataset.qty); cart[index].qty += Number(button.dataset.delta); if (cart[index].qty < 1) cart.splice(index, 1); renderCart() } button = event.target.closest('[data-remove]'); if (button) { cart.splice(Number(button.dataset.remove), 1); renderCart() } });
$('#clear-cart').onclick = () => { if (checkoutInProgress) return; cart.splice(0, cart.length); renderCart() };
function showCart() { renderCart(); $('#overlay').hidden = false; $('#cart-drawer').classList.add('open'); $('#cart-drawer').setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden' }
function hideCart() { $('#overlay').hidden = true; $('#cart-drawer').classList.remove('open'); $('#cart-drawer').setAttribute('aria-hidden', 'true'); document.body.style.overflow = '' }
$('#open-cart').onclick = showCart; $('#close-cart').onclick = hideCart; $('#overlay').onclick = hideCart; $('#back-menu').onclick = () => { hideCart(); location.hash = '#cardapio' };
document.addEventListener('keydown', event => { if (event.key === 'Escape') { hideCart(); $('#product-modal').hidden = true; document.body.style.overflow = '' } });
function syncFulfillment() { const delivery = document.querySelector('[name=fulfillment]:checked').value === 'delivery'; $('#delivery-fields').hidden = !delivery; const apartment = delivery && $('#residence-type').value === 'Apartamento'; $('#apartment-field').hidden = !apartment; $('#apartment-number').required = apartment; $('#block-field').hidden = !apartment; $('#block').required = apartment; if (!apartment) { $('#apartment-number').value = ''; $('#block').value = ''; clearError('apartmentNumber'); clearError('block') } renderCart() }
document.querySelectorAll('[name=fulfillment]').forEach(radio => radio.addEventListener('change', syncFulfillment));
$('#district').addEventListener('change', () => { clearError('district'); const consult = isConsultDelivery(); $('#other-district-field').hidden = !consult; $('#other-district').required = consult; if (!consult) { $('#other-district').value = ''; clearError('otherDistrict') } $('#neighborhood-help').textContent = consult ? 'Digite o nome do bairro; a equipe informará a taxa de entrega pelo WhatsApp.' : 'A taxa de entrega será calculada para o bairro selecionado.'; syncPayment(); renderCart() });
$('#residence-type').addEventListener('change', () => { syncFulfillment(); clearError('residenceType') });
function syncPayment() { const cash = $('#payment').value === 'Dinheiro'; $('#cash-change-fields').hidden = !cash; if (!cash) $('#needs-change').checked = false; const wantsChange = cash && $('#needs-change').checked; $('#change-wrap').hidden = !wantsChange; $('#change').required = wantsChange; $('#change-consult-note').hidden = !wantsChange || !isConsultDelivery(); if (!cash || !$('#needs-change').checked) { $('#change').value = ''; clearError('change') } }
$('#payment').addEventListener('change', () => { syncPayment(); clearError('payment') }); $('#needs-change').addEventListener('change', syncPayment);
document.querySelectorAll('#checkout [name]').forEach(field => field.addEventListener('input', () => clearError(field.name)));
function clearError(name) { const slot = document.querySelector(`[data-error="${name}"]`); if (slot) slot.textContent = ''; const field = document.querySelector(`#checkout [name="${name}"]`); if (field) field.removeAttribute('aria-invalid') }
function setError(name, message) { const slot = document.querySelector(`[data-error="${name}"]`); if (slot) slot.textContent = message; const field = document.querySelector(`#checkout [name="${name}"]`); if (field) field.setAttribute('aria-invalid', 'true') }
function parseMoneyCents(value) { let raw = String(value || '').trim().replace(/[R$\s]/g, ''); if (!raw) return null; if (raw.includes(',')) raw = raw.replace(/\./g, '').replace(',', '.'); if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null; const amount = Number(raw); return Number.isFinite(amount) ? Math.round(amount * 100) : null }
function validateCheckout(form) {
  document.querySelectorAll('[data-error]').forEach(slot => slot.textContent = ''); $('#checkout-error').hidden = true; $('#checkout-error').textContent = '';
  const data = new FormData(form), fulfillment = data.get('fulfillment'), payment = data.get('payment');
  for (const [name, message] of [['customer', 'Informe seu nome completo.'], ['phone', 'Informe um telefone para contato.']]) if (!String(data.get(name) || '').trim()) setError(name, message);
  const nameParts = String(data.get('customer') || '').trim().split(/\s+/).filter(Boolean); if (nameParts.length === 1) setError('customer', 'Informe seu nome e sobrenome.');
  const digits = String(data.get('phone') || '').replace(/\D/g, ''); const localDigits = digits.startsWith('55') && [12, 13].includes(digits.length) ? digits.slice(2) : digits; if (digits && ![10, 11].includes(localDigits.length)) setError('phone', 'Informe um telefone com DDD: 10 dígitos para fixo ou 11 para celular.');
  if (!payment) setError('payment', 'Selecione a forma de pagamento.');
  let neighborhood = null, fee = 0;
  if (fulfillment === 'delivery') {
    for (const [name, message] of [['street', 'Informe o nome da rua ou avenida.'], ['houseNumber', 'Informe o número da residência ou unidade.'], ['residenceType', 'Selecione o tipo de residência.']]) if (!String(data.get(name) || '').trim()) setError(name, message);
    neighborhood = selectedNeighborhood();
    if (!config.neighborhoods.length) setError('district', 'A lista de bairros atendidos precisa ser configurada pela hamburgueria.');
    else if (!neighborhood) setError('district', 'Selecione um bairro válido da lista.');
    else if (neighborhood.consultDelivery && !String(data.get('otherDistrict') || '').trim()) setError('otherDistrict', 'Digite o nome do bairro.');
    else if (!neighborhood.consultDelivery) { const configured = deliveryFeeCents(); if (configured === null) setError('district', 'A taxa deste bairro ainda precisa ser configurada.'); else fee = configured }
    if (data.get('residenceType') === 'Apartamento' && !String(data.get('apartmentNumber') || '').trim()) setError('apartmentNumber', 'Informe o número do apartamento.');
    if (data.get('residenceType') === 'Apartamento' && !String(data.get('block') || '').trim()) setError('block', 'Informe o bloco do apartamento.');
  }
  const subtotal = cart.reduce((sum, item) => sum + item.priceCents * item.qty, 0), total = subtotal + fee;
  const invalidAcai = cart.find(item => item.category === 'Açaí' && item.toppings.length > acaiLimit(item)); if (invalidAcai) { $('#checkout-error').textContent = `O item ${invalidAcai.name} excede o limite de acompanhamentos.`; $('#checkout-error').hidden = false; return null }
  if (payment === 'Dinheiro' && $('#needs-change').checked) { const change = parseMoneyCents(data.get('change')); if (change === null) setError('change', 'Informe quanto dinheiro será entregue para o troco.'); else if (change <= total) setError('change', 'O valor para troco precisa ser maior que o total do pedido.') }
  const invalid = document.querySelector('#checkout [aria-invalid="true"]'); if (invalid) { invalid.focus(); return null }
  if (fulfillment === 'delivery' && !isConsultDelivery() && deliveryFeeCents() === null) { $('#checkout-error').textContent = 'Não foi possível calcular a entrega. Confira o bairro e a taxa cadastrada.'; $('#checkout-error').hidden = false; return null }
  return { data, fulfillment, payment, neighborhood, fee, subtotal, total };
}
$('#checkout').addEventListener('submit', async event => {
  event.preventDefault();
  if (checkoutInProgress) return;
  if (!cart.length) { $('#checkout-error').textContent = 'Adicione pelo menos um produto à sacola.'; $('#checkout-error').hidden = false; return }
  const checkoutForm = event.currentTarget, validated = validateCheckout(checkoutForm);
  if (!validated) return;
  const { data, fulfillment, payment, neighborhood, fee, subtotal, total } = validated;
  const consult = fulfillment === 'delivery' && isConsultDelivery();
  const districtName = fulfillment === 'delivery' ? (consult ? String(data.get('otherDistrict')).trim() : neighborhood.name) : null;
  const needsChange = payment === 'Dinheiro' && $('#needs-change').checked;
  const changeCents = needsChange ? parseMoneyCents(data.get('change')) : null;
  const addressData = fulfillment === 'delivery' ? {
    street: String(data.get('street')).trim(), house_number: String(data.get('houseNumber')).trim(),
    residence_type: String(data.get('residenceType')).trim(),
    apartment_number: data.get('residenceType') === 'Apartamento' ? String(data.get('apartmentNumber')).trim() : null,
    block: data.get('residenceType') === 'Apartamento' ? String(data.get('block')).trim() : null,
    complement: String(data.get('complement') || '').trim(), reference: String(data.get('reference') || '').trim()
  } : null;
  const items = cart.map(item => ({
    product_id: item.id, quantity: item.qty, base_unit_price: item.basePriceCents / 100,
    unit_price: item.priceCents / 100,
    extras: item.extras.map(extra => ({ name: extra.name, price: extra.priceCents / 100 })),
    toppings: [...item.toppings], item_notes: item.notes
  }));
  const order = {
    customer_name: String(data.get('customer')).trim(), phone: String(data.get('phone')).trim(), fulfillment,
    neighborhood: districtName, address: addressData, payment_method: payment,
    needs_change: needsChange, change_for: changeCents === null ? null : changeCents / 100,
    products_subtotal: subtotal / 100, discount: 0, delivery_fee: consult ? null : fee / 100,
    consult_delivery: consult, total: consult ? null : total / 100, notes: String(data.get('notes') || '').trim()
  };
  const waWindow = window.open('about:blank', '_blank');
  if (!waWindow) {
    $('#checkout-error').textContent = 'Permita a abertura de uma nova aba para continuar pelo WhatsApp. O pedido ainda não foi enviado.';
    $('#checkout-error').hidden = false;
    return;
  }
  try { waWindow.document.title = 'Registrando pedido'; waWindow.document.body.textContent = 'Registrando seu pedido com segurança…' } catch { }
  checkoutInProgress = true;
  $('#checkout-error').hidden = true;
  const submitButton = checkoutForm.querySelector('[type="submit"]'), originalButton = submitButton.innerHTML;
  const controls = [...checkoutForm.elements], disabledStates = controls.map(control => control.disabled);
  controls.forEach(control => { control.disabled = true });
  submitButton.textContent = 'Registrando pedido…';
  checkoutForm.setAttribute('aria-busy', 'true');
  let orderSaved = false, orderId = '', whatsappUrl = '';
  try {
    const fingerprint = await fingerprintOrder({ order, items });
    if (!pendingOrderRequest || pendingOrderRequest.fingerprint !== fingerprint) {
      pendingOrderRequest = { id: newOrderRequestId(), fingerprint };
      try { sessionStorage.setItem(orderRequestStorageKey, JSON.stringify(pendingOrderRequest)) } catch { }
    }
    const result = await window.TopetsSupabase.createOrder(pendingOrderRequest.id, order, items);
    orderId = typeof result === 'string' ? result : result?.id;
    if (!orderId) throw new Error('A confirmação do registro não foi retornada pelo Supabase. Tente novamente; o envio é protegido contra duplicidade.');
    orderSaved = true;

    const address = [];
    if (fulfillment === 'delivery') {
      address.push(`${addressData.street}, ${addressData.house_number}`);
      if (addressData.residence_type === 'Apartamento') address.push(`Apartamento ${addressData.apartment_number} bloco ${addressData.block}`);
      else address.push(`Residência: ${addressData.residence_type}`);
      if (addressData.complement) address.push(`Complemento: ${addressData.complement}`);
      if (addressData.reference) address.push(`Referência: ${addressData.reference}`);
    }
    const lines = ['*PEDIDO — TOPET’S LANCHES*', `*Protocolo:* ${orderId}`, '', `*Cliente:* ${order.customer_name}`, `*Telefone:* ${order.phone}`, '', ...cart.map(item => {
      const itemSubtotal = item.priceCents * item.qty;
      let line = `• ${item.qty}x ${item.name} — ${moneyCents(itemSubtotal)}`;
      if (item.extras.length) line += `\n  Adicionais: ${item.extras.map(extra => `${extra.name} (+${moneyCents(extra.priceCents)})`).join(', ')}`;
      if (item.toppings.length) line += `\n  Acompanhamentos: ${item.toppings.join(', ')}`;
      if (item.notes) line += `\n  Observação: ${item.notes}`;
      return line;
    }), '', `*Subtotal dos produtos:* ${moneyCents(subtotal)}`,
    ...(fulfillment === 'delivery' ? [`*Bairro:* ${districtName}`, `*Taxa de entrega:* ${consult ? 'A confirmar com a loja' : moneyCents(fee)}`] : []),
    `*Total:* ${consult ? 'A confirmar com a loja' : moneyCents(total)}`, '',
    `*Pedido:* ${fulfillment === 'delivery' ? 'Entrega' : 'Retirada no local'}`,
    ...(fulfillment === 'delivery' ? [`*Endereço:* ${address.join(' | ')}`] : []),
    `*Pagamento:* ${payment}`,
    ...(needsChange ? [`*Troco para:* ${String(data.get('change')).trim()}${consult ? ' (calculado sem a taxa de entrega; consultar com a loja)' : ''}`] : []),
    ...(order.notes ? [`*Observações gerais:* ${order.notes}`] : [])];
    whatsappUrl = `https://wa.me/${config.whatsapp}?text=${encodeURIComponent(lines.join('\n'))}`;
    cart.splice(0, cart.length); save(); renderCart(); checkoutForm.reset(); syncFulfillment(); syncPayment();
    pendingOrderRequest = null;
    try { sessionStorage.removeItem(orderRequestStorageKey) } catch { }
    try { waWindow.opener = null; waWindow.location.replace(whatsappUrl) }
    catch { try { waWindow.close() } catch { } }
    if (waWindow.closed) {
      const errorBox = $('#checkout-error');
      errorBox.textContent = `Pedido registrado (protocolo ${orderId}), mas a nova aba do WhatsApp não abriu. `;
      const link = document.createElement('a'); link.href = whatsappUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Toque aqui para continuar no WhatsApp';
      errorBox.append(link); errorBox.hidden = false;
    }
  } catch (error) {
    try { waWindow.close() } catch { }
    const errorBox = $('#checkout-error');
    if (orderSaved) {
      cart.splice(0, cart.length); save(); renderCart(); checkoutForm.reset(); syncFulfillment(); syncPayment();
      pendingOrderRequest = null; try { sessionStorage.removeItem(orderRequestStorageKey) } catch { }
      errorBox.textContent = `Pedido registrado (protocolo ${orderId}), mas não conseguimos abrir o WhatsApp. `;
      if (whatsappUrl) { const link = document.createElement('a'); link.href = whatsappUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Toque aqui para continuar no WhatsApp'; errorBox.append(link) }
    } else errorBox.textContent = `Não foi possível confirmar o registro do pedido. O WhatsApp não foi aberto. ${error.message || 'Verifique sua conexão e tente novamente; a mesma tentativa será reutilizada para evitar duplicidade.'}`;
    errorBox.hidden = false;
  } finally {
    controls.forEach((control, index) => { control.disabled = disabledStates[index] });
    submitButton.innerHTML = originalButton;
    checkoutForm.removeAttribute('aria-busy');
    checkoutInProgress = false;
  }
});
function toast(message) { const element = document.createElement('div'); element.textContent = message; element.style.cssText = 'position:fixed;z-index:50;bottom:22px;left:50%;transform:translateX(-50%);background:#211b18;color:white;border-radius:24px;padding:12px 19px;font-size:12px;box-shadow:0 8px 28px #0003'; document.body.append(element); setTimeout(() => element.remove(), 1800) }
renderNeighborhoods(); syncFulfillment(); syncPayment(); renderMenu(); renderCart();
