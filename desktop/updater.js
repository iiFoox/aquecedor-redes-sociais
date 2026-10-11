// Atualização do aplicativo pelo bucket público "downloads" do Supabase.
// O plano gratuito aceita arquivos de até 50 MB, e o instalador tem mais que isso: o "npm run publicar" corta o
// instalador em partes e grava latest.json ({ version, file, sha256, size, parts: [{ name, sha256, size }] }).
// Aqui: baixa as partes, confere cada uma e o instalador inteiro (SHA-256), e instala em silêncio.
// base: endereço da pasta de downloads (o teste de ponta a ponta usa um servidor local; o app usa BASE).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { newer } = require('./logic');

const BASE = 'https://cuuuudyjqjyeqvvfqtkl.supabase.co/storage/v1/object/public/downloads';

// Canais: "estavel" (latest.json, todos os aparelhos) e "teste" (latest-teste.json, só os aparelhos do dono que testam).
// "npm run publicar" publica no teste; "npm run liberar" passa a versão em teste para o estável.
const CHANNELS = { estavel: 'latest.json', teste: 'latest-teste.json' };
const channelOf = (c) => (c === 'teste' ? 'teste' : 'estavel');

async function latest(current, base = BASE, channel = 'estavel') {
  const r = await fetch(`${base}/${CHANNELS[channelOf(channel)]}?t=${Date.now()}`, { cache: 'no-store' });
  if (r.status === 400 || r.status === 404) return null; // nada publicado ainda
  if (!r.ok) throw new Error(`Servidor de atualização respondeu ${r.status}`);
  const m = await r.json();
  if (!m || typeof m.version !== 'string' || !Array.isArray(m.parts) || !/^[a-f0-9]{64}$/.test(m.sha256 || ''))
    throw new Error('Aviso de versão inválido');
  return newer(m.version, current) ? m : null;
}

// Baixa e confere. Devolve o caminho do instalador pronto.
async function download(m, dir, onProgress = () => {}, base = BASE) {
  fs.mkdirSync(dir, { recursive: true });
  const exe = path.join(dir, path.basename(m.file || `WarmUp-Studio-Setup-${m.version}.exe`));
  // Já baixado antes e íntegro: usa
  if (fs.existsSync(exe) && (await hashFile(exe)) === m.sha256) return exe;
  const all = crypto.createHash('sha256');
  const out = fs.createWriteStream(`${exe}.parcial`);
  let done = 0;
  try {
    for (const p of m.parts) {
      if (!/^[\w.-]+$/.test(p.name)) throw new Error('Nome de parte inválido');
      // Cada parte (45 MB) tem até 10 min: internet que cai no meio não deixa a atualização presa para sempre
      const r = await fetch(`${base}/${encodeURIComponent(p.name)}`, { cache: 'no-store', signal: AbortSignal.timeout(10 * 60000) });
      if (!r.ok) throw new Error(`Parte ${p.name}: ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (crypto.createHash('sha256').update(buf).digest('hex') !== p.sha256) throw new Error(`Parte ${p.name} chegou corrompida`);
      all.update(buf);
      await new Promise((res, rej) => out.write(buf, (e) => (e ? rej(e) : res())));
      done += buf.length;
      onProgress(done / m.size);
    }
  } finally {
    await new Promise((res) => out.end(res));
  }
  if (all.digest('hex') !== m.sha256) {
    fs.rmSync(`${exe}.parcial`, { force: true });
    throw new Error('O instalador baixado não confere');
  }
  fs.renameSync(`${exe}.parcial`, exe);
  return exe;
}

function hashFile(file) {
  return new Promise((resolve) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', () => resolve(null));
  });
}

// Instala sem perguntar (/S) e abre o app de novo no fim (--force-run). --updated: o instalador espera o app fechar
// (e fecha o que sobrar) em vez de perguntar. Os dados ficam em %APPDATA%.
// Resolve quando o instalador começou de verdade; rejeita se nem abriu (arquivo sumiu, antivírus barrou...).
function install(exe) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(exe, ['/S', '--force-run', '--updated'], { detached: true, stdio: 'ignore', windowsHide: true });
    } catch (e) {
      return reject(e);
    }
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve(child.pid);
    });
  });
}

module.exports = { latest, download, install, hashFile, BASE, CHANNELS, channelOf };
