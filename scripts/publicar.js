// Gera o instalador do aplicativo do Windows e publica a versão para os aparelhos atualizarem sozinhos.
//   npm run instalador   só gera (release/WarmUp-Studio-Setup-<versão>.exe)
//   npm run publicar     gera e envia para o bucket público "downloads" do Supabase (em partes de 45 MB + latest.json)
// Antes de publicar, suba a versão em package.json ("version"): é ela que os aparelhos comparam.
// Usa a chave secreta do .env só para ENVIAR os arquivos; ela nunca entra no instalador (conferido aqui).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { chunks, newer } = require('../desktop/logic');

const ROOT = path.join(__dirname, '..');
const RELEASE = path.join(ROOT, 'release');
const BUCKET = 'downloads';
const onlyBuild = process.argv.includes('--so-gerar');
const { version } = require('../package.json');

const fail = (msg) => {
  console.error(`❌ ${msg}`);
  process.exit(1);
};
const run = (args) => {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit', windowsHide: true });
  if (r.status !== 0) fail(`Falhou: ${args.join(' ')}`);
};

// Nada de segredo dentro do app: sem .env, sem pasta data/ e sem a chave secreta em nenhum arquivo
function auditar(dir) {
  let secret = null;
  try {
    process.loadEnvFile(path.join(ROOT, '.env'));
    secret = process.env.SUPABASE_KEY || null;
  } catch {
    /* sem .env: não há segredo para procurar */
  }
  const problems = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const rel = path.relative(dir, p);
      if (e.isDirectory()) {
        if (rel === 'data' || rel === path.join('app', 'data')) problems.push(`pasta de dados: ${rel}`);
        walk(p);
      } else {
        if (e.name === '.env' || e.name === 'motor.token' || e.name === 'vault-key.bin' || e.name === 'device-session.bin')
          problems.push(`arquivo proibido: ${rel}`);
        if (secret && fs.statSync(p).size < 30 * 1048576 && fs.readFileSync(p).includes(secret)) problems.push(`chave secreta em: ${rel}`);
      }
    }
  };
  walk(dir);
  if (problems.length) fail(`O instalador levaria segredos:\n  ${problems.join('\n  ')}`);
  console.log('🔒 Conferido: nenhum segredo dentro do aplicativo.');
}

const PART_MB = 45; // o plano gratuito do Supabase aceita até 50 MB por arquivo

async function enviar(exe) {
  process.loadEnvFile(path.join(ROOT, '.env'));
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { auth: { persistSession: false } });
  const put = async (name, body, type) => {
    process.stdout.write(`⬆️  ${name} (${(body.length / 1048576).toFixed(1)} MB)... `);
    const { error } = await sb.storage.from(BUCKET).upload(name, body, { upsert: true, contentType: type, cacheControl: '60' });
    if (error) fail(`não subiu: ${error.message}`);
    console.log('ok');
  };
  const buf = fs.readFileSync(exe);
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
  const parts = chunks(buf.length, PART_MB * 1048576).map(([s, e], i) => ({
    name: `WarmUp-Studio-${version}.parte${i + 1}`,
    buf: buf.subarray(s, e),
  }));
  for (const p of parts) await put(p.name, p.buf, 'application/octet-stream');
  await put('instalar.ps1', fs.readFileSync(path.join(__dirname, 'instalar.ps1')), 'text/plain');
  const manifest = {
    version,
    file: path.basename(exe),
    size: buf.length,
    sha256: sha(buf),
    date: new Date().toISOString(),
    parts: parts.map((p) => ({ name: p.name, size: p.buf.length, sha256: sha(p.buf) })),
  };
  // Por último: é ele que avisa os aparelhos que há versão nova
  await put('latest.json', Buffer.from(JSON.stringify(manifest, null, 2)), 'application/json');
  // Partes de versões antigas saem (fica só a atual e a anterior)
  const { data } = await sb.storage.from(BUCKET).list('', { limit: 1000 });
  const versions = [...new Set((data || []).map((f) => (f.name.match(/^WarmUp-Studio-(.+)\.parte\d+$/) || [])[1]).filter(Boolean))];
  const keep = versions.sort((a, b) => (newer(a, b) ? -1 : 1)).slice(0, 2);
  const old = (data || []).filter((f) => /\.parte\d+$/.test(f.name) && !keep.some((v) => f.name.startsWith(`WarmUp-Studio-${v}.`)));
  if (old.length) await sb.storage.from(BUCKET).remove(old.map((f) => f.name));
}

(async () => {
  console.log(`📦 WarmUp Studio ${version}`);
  run([path.join(ROOT, 'scripts', 'build-web.js'), '--force']);
  fs.rmSync(RELEASE, { recursive: true, force: true });
  run([path.join(ROOT, 'node_modules', 'electron-builder', 'cli.js'), '--win', '--x64', '--publish', 'never']);
  auditar(path.join(RELEASE, 'win-unpacked'));
  const exe = path.join(RELEASE, `WarmUp-Studio-Setup-${version}.exe`);
  if (!fs.existsSync(exe)) fail(`Não achei ${exe}`);
  console.log(`✅ Instalador: ${exe}`);
  if (onlyBuild) return;
  await enviar(exe);
  console.log(`\n✅ Versão ${version} publicada. Os aparelhos atualizam em até 6 h (ou "Procurar atualização" no ícone).`);
  console.log('   Instalar num aparelho novo (PowerShell):');
  console.log(`   irm ${process.env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/instalar.ps1 | iex`);
})();
