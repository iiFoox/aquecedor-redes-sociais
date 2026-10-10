// Gera o instalador do aplicativo do Windows e publica a versão no CANAL DE TESTE.
//   npm run instalador   só gera (release/WarmUp-Studio-Setup-<versão>.exe)
//   npm run publicar     gera e envia para o bucket público "downloads" do Supabase (partes de 45 MB + latest-teste.json):
//                        só os aparelhos com "Receber atualizações em teste" ligado recebem (o PC do dono)
//   npm run liberar      (scripts/liberar.js) passa a versão em teste para todos os aparelhos (latest.json)
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
const force = process.argv.includes('--forcar'); // publicar de novo a mesma versão (ex.: corrigir um envio que falhou)
const { version } = require('../package.json');

// Erro: para tudo e sai com código 1 (sem process.exit no meio: no Windows ele quebra com conexões abertas)
const fail = (msg) => {
  throw Object.assign(new Error(msg), { publicar: true });
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
  const manifest = {
    version,
    file: path.basename(exe),
    size: buf.length,
    sha256: sha(buf),
    date: new Date().toISOString(),
    parts: parts.map((p) => ({ name: p.name, size: p.buf.length, sha256: sha(p.buf) })),
  };
  // Por último: é ele que avisa os aparelhos do canal de teste que há versão nova
  await put('latest-teste.json', Buffer.from(JSON.stringify(manifest, null, 2)), 'application/json');
  // Partes de versões antigas saem: ficam as duas mais novas e a liberada para todos (nunca apagar a do estável)
  const { data } = await sb.storage.from(BUCKET).list('', { limit: 1000 });
  const versions = [...new Set((data || []).map((f) => (f.name.match(/^WarmUp-Studio-(.+)\.parte\d+$/) || [])[1]).filter(Boolean))];
  const stable = await publicada('estavel');
  const keep = versions.sort((a, b) => (newer(a, b) ? -1 : 1)).slice(0, 2);
  if (stable) keep.push(stable);
  const old = (data || []).filter((f) => /\.parte\d+$/.test(f.name) && !keep.some((v) => f.name.startsWith(`WarmUp-Studio-${v}.`)));
  if (old.length) await sb.storage.from(BUCKET).remove(old.map((f) => f.name));
}

// Versão já publicada num canal (os aparelhos só atualizam se a nova for maior)
async function publicada(canal = 'teste') {
  const { BASE, CHANNELS } = require('../desktop/updater');
  const r = await fetch(`${BASE}/${CHANNELS[canal]}?t=${Date.now()}`).catch(() => null);
  if (!r || !r.ok) return null;
  return (await r.json().catch(() => ({}))).version || null;
}

(async () => {
  console.log(`📦 WarmUp Studio ${version}`);
  // Toda versão entra no "O que há de novo?" antes de sair (web/src/novidades.ts)
  const novidades = fs.readFileSync(path.join(ROOT, 'web', 'src', 'novidades.ts'), 'utf8');
  if (!novidades.includes(`versao: '${version}'`))
    fail(`A versão ${version} não está em web/src/novidades.ts. Escreva o que mudou ("O que há de novo?") antes de publicar.`);
  if (!onlyBuild && !force) {
    const atual = [await publicada('teste'), await publicada('estavel')].filter(Boolean).sort((a, b) => (newer(a, b) ? -1 : 1))[0];
    if (atual && !newer(version, atual))
      fail(
        `A versão ${version} não é mais nova que a publicada (${atual}). Suba "version" no package.json (ex.: ${atual.replace(/\d+$/, (n) => Number(n) + 1)}).`,
      );
  }
  run([path.join(ROOT, 'scripts', 'build-web.js'), '--force']);
  fs.rmSync(RELEASE, { recursive: true, force: true });
  run([path.join(ROOT, 'node_modules', 'electron-builder', 'cli.js'), '--win', '--x64', '--publish', 'never']);
  auditar(path.join(RELEASE, 'win-unpacked'));
  const exe = path.join(RELEASE, `WarmUp-Studio-Setup-${version}.exe`);
  if (!fs.existsSync(exe)) fail(`Não achei ${exe}`);
  console.log(`✅ Instalador: ${exe}`);
  if (onlyBuild) return;
  await enviar(exe);
  console.log(`\n✅ Versão ${version} publicada no CANAL DE TESTE. Só os aparelhos com "Receber atualizações em teste"`);
  console.log('   recebem (em até 6 h, ou "Procurar atualização" no ícone). Os outros continuam na versão liberada.');
  console.log('   Testou e está tudo certo? npm run liberar (passa esta versão para todos os aparelhos).');
})().catch((e) => {
  console.error(`❌ ${e.publicar ? e.message : e.stack}`);
  process.exitCode = 1;
});
