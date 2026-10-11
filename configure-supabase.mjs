import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const directory = dirname(fileURLToPath(import.meta.url));
let envFile = '';
try { envFile = await readFile(join(directory, '..', '.env'), 'utf8'); } catch { }
const parsed = Object.fromEntries(envFile.split(/\r?\n/).map(line => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map(([, key, value]) => [key, value.replace(/^['"]|['"]$/g, '')]));
const url = process.env.SUPABASE_URL || parsed.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY || parsed.SUPABASE_ANON_KEY;
if (!url || !/^https:\/\//.test(url) || !anonKey || /your-project|your-public-anon-key/i.test(`${url} ${anonKey}`)) {
  console.error('Configure SUPABASE_URL e SUPABASE_ANON_KEY no ambiente de build ou no arquivo .env na pasta acima de outputs.');
  process.exit(1);
}
const contents = `// Gerado durante o build. Contém somente URL e chave pública anon.\nwindow.TOPETS_SUPABASE_CONFIG = ${JSON.stringify({ url: url.replace(/\/$/, ''), anonKey })};\n`;
await writeFile(join(directory, 'supabase-config.js'), contents, 'utf8');
console.log('supabase-config.js gerado com a configuração pública do Supabase.');
