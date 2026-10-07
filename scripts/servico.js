// Liga, desliga e acompanha o WarmUp Studio em segundo plano (PM2).
//   npm run ligar                 liga motor + painel (reiniciam sozinhos se caírem)
//   npm run desligar              desliga os dois com segurança
//   npm run status                mostra se estão rodando
//   npm run logs                  acompanha os registros
//   npm run autostart:ligar       liga sozinho quando você entra no Windows
//   npm run autostart:desligar    tira da inicialização do Windows
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PM2 = path.join(ROOT, 'node_modules', 'pm2', 'bin', 'pm2');
const LOGS = path.join(ROOT, 'data', 'logs');
const APPS = ['warmup-motor', 'warmup-painel'];
const STARTUP = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'Microsoft',
  'Windows',
  'Start Menu',
  'Programs',
  'Startup',
);
const SHORTCUT = path.join(STARTUP, 'WarmUp Studio.vbs');
const MAX_LOG_MB = 20;

const pm2 = (...args) => spawnSync(process.execPath, [PM2, ...args], { cwd: ROOT, stdio: 'inherit', windowsHide: true }).status;

// Log grande vira .old (fica só o anterior), para não crescer para sempre
function rotateLogs() {
  fs.mkdirSync(LOGS, { recursive: true });
  for (const f of fs.readdirSync(LOGS).filter((x) => x.endsWith('.log'))) {
    const p = path.join(LOGS, f);
    if (fs.statSync(p).size > MAX_LOG_MB * 1048576) fs.renameSync(p, `${p}.old`);
  }
}

const commands = {
  ligar() {
    rotateLogs();
    require('./build-web').build();
    const code = pm2('start', path.join(ROOT, 'ecosystem.config.js'));
    if (code === 0) console.log('\n✅ WarmUp Studio ligado em segundo plano. Painel: http://localhost:3001');
    return code;
  },
  desligar() {
    const code = pm2('delete', ...APPS);
    if (code === 0) console.log('\n✅ WarmUp Studio desligado (sessões fechadas e dados salvos).');
    return code;
  },
  reiniciar: () => pm2('reload', path.join(ROOT, 'ecosystem.config.js')),
  status: () => pm2('status'),
  logs: () => pm2('logs', '--lines', '60', ...APPS),
  'autostart:ligar'() {
    if (process.platform !== 'win32') {
      console.error('A inicialização automática só foi preparada para o Windows.');
      return 1;
    }
    // Atalho invisível na pasta Inicializar: roda "npm run ligar" sem abrir janela de terminal
    const q = (s) => s.replace(/"/g, '""');
    const vbs = [
      "' WarmUp Studio: liga o motor e o painel ao entrar no Windows (criado por npm run autostart:ligar)",
      'Set sh = CreateObject("WScript.Shell")',
      `sh.CurrentDirectory = "${q(ROOT)}"`,
      `sh.Run """${q(process.execPath)}"" ""${q(path.join(ROOT, 'scripts', 'servico.js'))}"" ligar", 0, False`,
      '',
    ].join('\r\n');
    fs.writeFileSync(SHORTCUT, vbs);
    console.log(`✅ Vai ligar sozinho quando você entrar no Windows.\n   Atalho: ${SHORTCUT}`);
    return 0;
  },
  'autostart:desligar'() {
    fs.rmSync(SHORTCUT, { force: true });
    console.log('✅ Removido da inicialização do Windows.');
    return 0;
  },
};

const cmd = process.argv[2];
if (!commands[cmd]) {
  console.log(`Comandos: ${Object.keys(commands).join(', ')}`);
  process.exit(1);
}
process.exit(commands[cmd]() || 0);
