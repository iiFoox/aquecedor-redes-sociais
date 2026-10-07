// Gera o painel (web/dist) se ele não existir ou se algum arquivo de web/ for mais novo que ele.
// Rodado pelo "npm start" e pelo "npm run ligar"; "npm run build" força sempre.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const WEB = path.join(__dirname, '..', 'web');
const OUT = path.join(WEB, 'dist', 'index.html');

function newest(dir) {
  let t = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'dist' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
  }
  return t;
}

function build({ force = false } = {}) {
  const stale = !fs.existsSync(OUT) || newest(WEB) > fs.statSync(OUT).mtimeMs;
  if (!force && !stale) return 0;
  console.log('🧱 Gerando o painel (web/dist)...');
  const vite = path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js');
  const r = spawnSync(process.execPath, [vite, 'build', '--config', path.join(WEB, 'vite.config.mts'), '--logLevel', 'warn'], {
    stdio: 'inherit',
    windowsHide: true,
  });
  if (r.status !== 0) console.error('❌ O painel não foi gerado. Rode "npm run build" para ver o erro.');
  return r.status || 0;
}

if (require.main === module) process.exit(build({ force: process.argv.includes('--force') }));
module.exports = { build };
