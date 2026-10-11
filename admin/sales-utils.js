(() => {
  const cents = value => {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new Error('Informe valores válidos e não negativos.');
    return Math.round(number * 100);
  };
  function totals(items, discount = 0, deliveryFee = 0) {
    const subtotal = items.reduce((sum, item) => sum + (cents(item.unit_price) + cents(item.extra_unit_price || 0)) * Number(item.quantity), 0);
    const discountCents = cents(discount), deliveryCents = cents(deliveryFee);
    if (discountCents > subtotal) throw new Error('O desconto não pode superar o valor dos produtos.');
    return { subtotal, discount: discountCents, delivery: deliveryCents, total: subtotal - discountCents + deliveryCents };
  }
  function summarize(sales) {
    const confirmed = sales.filter(sale => sale.status === 'confirmed');
    const revenue = confirmed.reduce((sum, sale) => sum + cents(sale.total), 0);
    const products = new Map(), days = new Map(), payments = new Map();
    for (const sale of confirmed) {
      payments.set(sale.payment_method, (payments.get(sale.payment_method) || 0) + cents(sale.total));
      const date = new Date(sale.sold_at);
      const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      days.set(day, (days.get(day) || 0) + cents(sale.total));
      for (const item of sale.sale_items || []) products.set(item.product_name, (products.get(item.product_name) || 0) + Number(item.quantity));
    }
    const productList = [...products].map(([name, quantity]) => ({ name, quantity })).sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, 'pt-BR'));
    return { revenue, count: confirmed.length, average: confirmed.length ? Math.round(revenue / confirmed.length) : 0,
      topProduct: productList[0] || null, products: productList,
      days: [...days].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date)),
      payments: [...payments].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value) };
  }
  const api = { cents, totals, summarize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.TopetsSalesUtils = api;
})();
