// Backup diário dos logins (data/profiles) às 04:00, num .tar.gz sem cache, guardando os 7 mais recentes.
// Só roda com tudo parado (navegador aberto trava os arquivos). Enquanto o backup do dia estiver
// pendente, o piloto automático não abre sessões novas; as que estão rodando terminam normalmente.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const store = require('./store');
const runner = require('./runner');
const rules = require('./rules');

const BACKUP_AT = '04:00';
const KEEP = 7;
const { DATA } = require('./paths');
const PREFIX = 'warmup-perfis-';

// Pastas de cache do Chrome: recriadas sozinhas, não vale guardar (são ~95% do tamanho)
const EXCLUDE = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'GrShaderCache',
  'ShaderCache',
  'GraphiteDawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'GPUPersistentCache',
  'CacheStorage',
  'ScriptCache',
  'component_crx_cache',
  'extensions_crx_cache',
  'Crashpad',
  'BrowserMetrics',
  'OptimizationGuideModelsManifest',
  'optimization_guide_model_store',
  'Safe Browsing',
  'segmentation_platform',
  'SingletonLock',
  'SingletonCookie',
  'SingletonSocket',
  'lockfile',
];

const backupDir = () => process.env.BACKUP_DIR || path.join(process.env.OneDrive || os.homedir(), 'Backups', 'WarmUp Studio');
const tarBin = () => (process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar');

let running = false;
let timer = null;

function tar(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(tarBin(), args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split('\n').pop() || `tar saiu com código ${code}`))));
  });
}

// Backups existentes, do mais novo para o mais antigo
function list(dir = backupDir()) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(PREFIX) && f.endsWith('.tar.gz'))
      .sort()
      .reverse()
      .map((f) => ({ file: f, path: path.join(dir, f), sizeMB: +(fs.statSync(path.join(dir, f)).size / 1048576).toFixed(1) }));
  } catch {
    return [];
  }
}

// 'AAAA-MM-DD_HHMMSS' no fuso do app (os segundos evitam que dois backups no mesmo minuto se sobrescrevam)
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) => {
  const m = rules.localMinutes(d);
  return `${rules.localDate(d)}_${pad(Math.floor(m / 60))}${pad(m % 60)}${pad(d.getSeconds())}`;
};

// Faz o backup agora. Recusa se houver navegador aberto.
async function run() {
  if (running) throw new Error('O backup já está rodando');
  if (runner.busy()) throw new Error('Há sessão ou navegador aberto. O backup roda quando tudo estiver parado.');
  if (!fs.existsSync(path.join(DATA, 'profiles'))) throw new Error('Ainda não há perfis para guardar');
  running = true;
  runner.setLock('Backup dos logins em andamento. Tente de novo em alguns segundos.');
  const dir = backupDir();
  const started = Date.now();
  const name = `${PREFIX}${stamp()}.tar.gz`;
  const tmp = path.join(dir, `${name}.parcial`);
  const listFile = path.join(DATA, 'contas.json');
  try {
    fs.mkdirSync(dir, { recursive: true });
    // Lista de qual pasta é qual conta, para a restauração saber o que está trazendo de volta
    const accounts = store.mine().map((a) => ({ id: a.id, platform: a.platform, username: a.username }));
    fs.writeFileSync(listFile, JSON.stringify({ at: new Date().toISOString(), accounts }, null, 2));
    await tar(['-czf', tmp, ...EXCLUDE.flatMap((x) => ['--exclude', x]), '-C', DATA, 'contas.json', 'profiles']);
    fs.renameSync(tmp, path.join(dir, name));
    for (const old of list(dir).slice(KEEP)) fs.rmSync(old.path, { force: true });
    const sizeMB = +(fs.statSync(path.join(dir, name)).size / 1048576).toFixed(1);
    const info = {
      at: Date.now(),
      file: name,
      dir,
      sizeMB,
      seconds: Math.round((Date.now() - started) / 1000),
      error: null,
      triedAt: Date.now(),
    };
    store.setConfig({ lastBackup: info });
    console.log(`💾 Backup dos logins: ${name} (${sizeMB} MB) em ${dir}`);
    runner.notify({ type: 'backup', backup: info });
    return info;
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    const prev = store.getConfig().lastBackup || {};
    store.setConfig({ lastBackup: { ...prev, error: e.message, triedAt: Date.now() } });
    console.error('❌ Backup dos logins falhou:', e.message);
    throw e;
  } finally {
    fs.rmSync(listFile, { force: true });
    runner.setLock(null);
    running = false;
  }
}

// Backup do dia pendente? (o agendador segura sessões novas enquanto for true)
const due = (now = new Date()) => rules.backupDue(now, store.getConfig().lastBackup, BACKUP_AT);
const hold = (now = new Date()) => running || due(now);

async function tick() {
  if (running || !due() || runner.busy()) return;
  await run().catch(() => {});
}

function status() {
  return { running, due: due(), at: BACKUP_AT, keep: KEEP, dir: backupDir(), last: store.getConfig().lastBackup, files: list() };
}

function start() {
  if (!timer) timer = setInterval(() => tick().catch(() => {}), 60000);
}
function stop() {
  clearInterval(timer);
  timer = null;
}

module.exports = { run, tick, due, hold, status, list, start, stop, backupDir, tarBin, EXCLUDE, PREFIX };
