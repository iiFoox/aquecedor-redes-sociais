// Libera para TODOS os aparelhos a versão que está no canal de teste (depois que o dono testou e aprovou).
//   npm run liberar   copia latest-teste.json para latest.json (o que os aparelhos no canal estável leem)
// Não gera nada de novo: é exatamente o instalador que foi testado (mesmas partes, mesmo SHA-256).
// Confere antes que todas as partes estão no servidor e batem com o SHA-256 do aviso.
const path = require('path');
const crypto = require('crypto');
const { newer } = require('../desktop/logic');
const { BASE, CHANNELS } = require('../desktop/updater');

const ROOT = path.join(__dirname, '..');
const BUCKET = 'downloads';
const fail = (msg) => {
  throw Object.assign(new Error(msg), { liberar: true });
};

async function manifesto(canal) {
  const r = await fetch(`${BASE}/${CHANNELS[canal]}?t=${Date.now()}`, { cache: 'no-store' });
  if (r.status === 400 || r.status === 404) return null;
  if (!r.ok) fail(`O servidor respondeu ${r.status} para ${CHANNELS[canal]}`);
  return r.json();
}

(async () => {
  const teste = await manifesto('teste');
  if (!teste) fail('Nada no canal de teste. Publique primeiro: npm run publicar');
  const estavel = await manifesto('estavel');
  if (estavel && !newer(teste.version, estavel.version))
    fail(`A versão em teste (${teste.version}) já está liberada (todos estão na ${estavel.version}). Nada novo para liberar.`);
  console.log(`📦 Liberando a versão ${teste.version} para todos (hoje eles estão na ${estavel ? estavel.version : 'nenhuma'})`);

  // O instalador testado tem de estar inteiro no servidor
  const all = crypto.createHash('sha256');
  for (const p of teste.parts) {
    const r = await fetch(`${BASE}/${encodeURIComponent(p.name)}`, { cache: 'no-store' });
    if (!r.ok) fail(`A parte ${p.name} sumiu do servidor (${r.status}). Publique de novo: npm run publicar -- --forcar`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (crypto.createHash('sha256').update(buf).digest('hex') !== p.sha256) fail(`A parte ${p.name} não bate com o SHA-256 do aviso`);
    all.update(buf);
    console.log(`   ✔ ${p.name}`);
  }
  if (all.digest('hex') !== teste.sha256) fail('O instalador montado não bate com o SHA-256 do aviso');

  process.loadEnvFile(path.join(ROOT, '.env'));
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { auth: { persistSession: false } });
  const put = async (name, body, type) => {
    const { error } = await sb.storage.from(BUCKET).upload(name, body, { upsert: true, contentType: type, cacheControl: '60' });
    if (error) fail(`${name} não subiu: ${error.message}`);
  };
  // Instalação em aparelho novo (sempre a versão liberada)
  await put('instalar.ps1', require('fs').readFileSync(path.join(__dirname, 'instalar.ps1')), 'text/plain; charset=utf-8');
  // Por último: é ele que avisa todos os aparelhos
  await put('latest.json', Buffer.from(JSON.stringify({ ...teste, liberadaEm: new Date().toISOString() }, null, 2)), 'application/json');
  console.log(`\n✅ Versão ${teste.version} liberada para todos os aparelhos. Eles atualizam em até 6 h (ou "Procurar atualização").`);
  console.log('   Instalar num aparelho novo (PowerShell):');
  console.log(`   irm ${process.env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/instalar.ps1 | iex`);
})().catch((e) => {
  console.error(`❌ ${e.liberar ? e.message : e.stack}`);
  process.exitCode = 1;
});
