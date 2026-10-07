// Restaura os logins (data/profiles) de um backup.
//   npm run restaurar                      lista os backups
//   npm run restaurar -- ultimo            restaura tudo do backup mais recente
//   npm run restaurar -- <arquivo>         restaura tudo daquele backup
//   npm run restaurar -- ultimo <conta>    restaura só uma conta (usuário ou ID da pasta)
// A pasta atual nunca é apagada: ela vira data/profiles-antes-<data> (ou <id>-antes-<data>).
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');

try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  /* sem .env */
}
const backup = require('../motor/backup');

const { DATA } = require('../motor/paths');
const PROFILES = path.join(DATA, 'profiles');
const MOTOR_PORT = Number(process.env.MOTOR_PORT) || 3101;
const stampNow = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

const die = (msg) => {
  console.error(`❌ ${msg}`);
  process.exit(1);
};

// O motor precisa estar parado: com ele ligado, o Chrome pode estar usando os arquivos
const motorOn = () =>
  new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: MOTOR_PORT, path: '/api/health', timeout: 2000 }, (r) => {
      r.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });

function tar(args) {
  const r = spawnSync(backup.tarBin(), args, { encoding: 'utf8', maxBuffer: 1e8 });
  if (r.status !== 0) die(`tar falhou: ${(r.stderr || r.error?.message || '').trim()}`);
  return r.stdout;
}

async function main() {
  const [which, who] = process.argv.slice(2);
  const files = backup.list();
  if (!which) {
    if (!files.length) return console.log(`Nenhum backup em ${backup.backupDir()}`);
    console.log(`Backups em ${backup.backupDir()}:\n`);
    files.forEach((f, i) => console.log(`  ${i === 0 ? '→' : ' '} ${f.file}  (${f.sizeMB} MB)`));
    console.log('\nPara restaurar: npm run restaurar -- ultimo   (ou o nome do arquivo; acrescente o usuário para só uma conta)');
    return;
  }

  const file = which === 'ultimo' ? files[0] : files.find((f) => f.file === which || f.path === which);
  if (!file) die(`Backup "${which}" não encontrado. Rode "npm run restaurar" para ver a lista.`);
  if (await motorOn()) die('O motor está ligado. Pare antes (npm run desligar, ou Ctrl+C no npm start) e rode de novo.');

  // Descobre a pasta da conta pela lista que vai dentro do backup
  let folder = null;
  if (who) {
    const list = JSON.parse(tar(['-xzOf', file.path, 'contas.json']) || '{"accounts":[]}').accounts;
    const acc = list.find((a) => a.id === who || a.username.toLowerCase() === who.replace(/^@/, '').toLowerCase());
    if (!acc) die(`A conta "${who}" não está nesse backup. Contas nele: ${list.map((a) => `@${a.username} (${a.id})`).join(', ')}`);
    folder = acc.id;
  }

  const stamp = stampNow();
  if (folder) {
    const cur = path.join(PROFILES, folder);
    if (fs.existsSync(cur)) fs.renameSync(cur, path.join(PROFILES, `${folder}-antes-${stamp}`));
    fs.mkdirSync(PROFILES, { recursive: true });
    tar(['-xzf', file.path, '-C', DATA, `profiles/${folder}`]);
    console.log(`✅ Conta ${who} restaurada de ${file.file}. A pasta anterior ficou em data/profiles/${folder}-antes-${stamp}`);
  } else {
    if (fs.existsSync(PROFILES)) fs.renameSync(PROFILES, path.join(DATA, `profiles-antes-${stamp}`));
    tar(['-xzf', file.path, '-C', DATA, 'profiles']);
    console.log(`✅ Logins restaurados de ${file.file}. A pasta anterior ficou em data/profiles-antes-${stamp}`);
  }
  console.log('   Pode ligar o motor de novo (npm run ligar ou npm start).');
}

main().catch((e) => die(e.message));
