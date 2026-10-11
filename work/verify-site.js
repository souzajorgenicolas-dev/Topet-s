const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const { menu, config } = require(path.join(root, 'outputs/data.js'));
const app = fs.readFileSync(path.join(root, 'outputs/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'outputs/index.html'), 'utf8');
const seed = fs.readFileSync(path.join(root, 'outputs/supabase/seed.sql'), 'utf8');
function extract(name) { const line = app.split(/\r?\n/).find(row => row.startsWith(`function ${name}(`)); return vm.runInNewContext('(' + line + ')'); }
const parseMoneyCents = extract('parseMoneyCents');
const acaiLimit = extract('acaiLimit');
for (const [input, expected] of [['50,00', 5000], ['50.5', 5050], ['1.234,56', 123456]]) if (parseMoneyCents(input) !== expected) throw new Error(`money parsing failed for ${input}`);
const acai = menu.filter(product => product.category === 'Açaí');
const limits = acai.map(acaiLimit);
if (JSON.stringify(limits) !== JSON.stringify([3, 3, 3, 5, 7])) throw new Error('açaí limits do not match');
if (!html.includes('name="street"') || !html.includes('name="district"') || !html.includes('name="needsChange"')) throw new Error('checkout fields missing');
if (!app.includes('localStorage.removeItem(cartKey)') || !app.includes('cart.splice(0, cart.length)')) throw new Error('cart reset behavior missing');
const seedBlock = seed.match(/from jsonb_to_recordset\('([\s\S]*)'::jsonb\) as product/);
if (!seedBlock) throw new Error('product seed JSON not found');
const seedRows = JSON.parse(seedBlock[1].replace(/''/g, "'"));
if (seedRows.length !== menu.length || new Set(seedRows.map(row => row.id)).size !== menu.length) throw new Error('seed count or IDs do not match source catalog');
for (const product of menu) {
  const migrated = seedRows.find(row => row.id === product.id);
  if (!migrated || migrated.name !== product.name || migrated.category !== product.category || Number(migrated.price) !== Number(product.price) || migrated.description !== product.description) throw new Error(`seed changed source product ${product.id}`);
}
console.log(JSON.stringify({ products: menu.length, migratedProducts: seedRows.length, uniqueIds: new Set(seedRows.map(row => row.id)).size, addons: config.addons.length, neighborhoodsConfigured: config.neighborhoods.length, acaiLimits: limits, moneyCases: 3 }));
