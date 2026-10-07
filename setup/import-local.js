// Importa as contas do backup local (data/accounts.json, da época antes do Supabase) para o Supabase.
// Uso:  node setup/import-local.js                 -> importa com os IDs originais
//       node setup/import-local.js antigo=novo     -> importa trocando o ID (pra usar outra pasta de perfil/login)
// IMPORTANTE: rode com o servidor DESLIGADO, senão ele sobrescreve com a lista que tem na memória.
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

process.loadEnvFile(path.join(__dirname, '..', '.env'));
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const remap = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=')));

(async () => {
  const file = path.join(__dirname, '..', 'data', 'accounts.json');
  const local = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { data: remote, error: e1 } = await sb.from('accounts').select('id, username, platform');
  if (e1) return console.error('❌ Erro lendo Supabase:', e1.message);

  const rows = [];
  for (const a of local) {
    const id = remap[a.id] || a.id;
    const dup = remote.find((r) => r.id !== id && r.username === a.username && r.platform === a.platform);
    if (dup) { console.log(`⏭  @${a.username} já existe no Supabase com id ${dup.id}, pulando`); continue; }
    const { live, loginOpen, id: _old, platform, username, ...rest } = a;
    rows.push({ id, platform, username, data: rest });
    console.log(`➕ @${username} (${platform}) id=${id}${id !== a.id ? ` (era ${a.id})` : ''}`);
  }
  if (!rows.length) return console.log('Nada para importar.');
  const { error } = await sb.from('accounts').upsert(rows);
  if (error) return console.error('❌ Erro ao gravar:', error.code, error.message, '\n   → Rodou o setup/supabase.sql?');
  console.log(`✅ ${rows.length} conta(s) importada(s) para o Supabase.`);
})();
